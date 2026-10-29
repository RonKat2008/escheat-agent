import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, outreach, type Outreach } from "@/db/schema";
import { draftLetterVariables, type LetterVariables } from "@/lib/agents/letter-writer";
import type { ClassifierItem } from "@/lib/agents/types";
import { now as clockNow } from "@/lib/clock";
import { addDays, type IsoDate } from "@/lib/dates";
import { getEnv, type Env } from "@/lib/env";
import { formatUSD } from "@/lib/money";
import { createOwnerToken, OwnerTokenConfigError } from "@/lib/outreach/tokens";
import { OutreachStateError } from "@/lib/outreach/errors";
import { buildLetterPayload, type LetterPayload } from "@/lib/outreach/payloads";
import { appBaseUrl, EDITABLE_STATUSES, mergeTracking } from "@/lib/outreach/util";
import { tryLoadRules } from "@/lib/rules/load";
import { kindOf, loadItemContext, PROPERTY_LABEL, type ItemContext } from "./context";
import { renderLetterHtml } from "./template";

export interface Readiness {
  ready: boolean;
  /** Blocking problems. Any entry means the letter must not be approved or mailed. */
  problems: string[];
  /** Non-blocking notes (for example unverified rule values). */
  warnings: string[];
}

export interface ComposeDeps {
  env?: Env;
  /** Override the model call (tests). Throwing any error falls back to the deterministic template. */
  draftVariables?: typeof draftLetterVariables;
  loadRules?: typeof tryLoadRules;
  /** Real-time clock for token expiry. */
  nowDate?: Date;
}

export const OWNER_LINK_TTL_DAYS = 90;
export const DE_NOTICE_DAYS = 30;

export interface ComposedLetter {
  outreachId: string;
  html: string;
  payload: LetterPayload | null;
  readiness: Readiness;
  variablesSource: "model" | "template";
  /** The plaintext owner link embedded in the letter (also in the HTML). */
  ownerUrl: string | null;
}

const longDate = (d: IsoDate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Deterministic variable parts. Contains no legal claims; used when the model is unavailable. */
export function templateVariables(ctx: ItemContext): LetterVariables {
  const label = PROPERTY_LABEL[ctx.ledger.propertyType] ?? "payment";
  const ref = ctx.ledger.referenceNumber ? ` ${ctx.ledger.referenceNumber}` : "";
  return {
    greeting: `Dear ${ctx.ownerName},`,
    itemDescription: `${ctx.company.name} issued ${label}${ref} for ${formatUSD(ctx.stale.amountCents)} on ${ctx.ledger.issueDate}. Our records show it has not been cashed or claimed.`,
    responseInstructions:
      "Please confirm your current mailing address, or let us know if this item was already paid, using the online link below or the contact details in this letter.",
  };
}

export function toClassifierItem(ctx: ItemContext): ClassifierItem {
  return {
    kind: kindOf(ctx.ledger.propertyType),
    number: ctx.ledger.referenceNumber,
    payee_name: ctx.ownerName,
    payee_address: ctx.ownerAddress?.line1 ?? null,
    payee_city: ctx.ownerAddress?.city ?? null,
    payee_state: ctx.ownerAddress?.state ?? null,
    payee_zip: ctx.ownerAddress?.zip ?? null,
    amount_cents: ctx.stale.amountCents,
    issue_date: ctx.ledger.issueDate,
    memo: ctx.ledger.memo,
    cleared_date: null,
  };
}

export async function resolveVariables(
  ctx: ItemContext,
  deps: ComposeDeps,
  db: Db,
): Promise<{ variables: LetterVariables; source: "model" | "template"; fallbackReason?: string }> {
  const draft = deps.draftVariables ?? draftLetterVariables;
  try {
    const variables = await draft(
      toClassifierItem(ctx),
      { name: ctx.ownerName, address: ctx.ownerAddress?.line1 ?? null },
      { name: ctx.company.name, contact: ctx.company.addressLine },
      { db, subjectId: ctx.stale.id, companyId: ctx.company.id, staleItemId: ctx.stale.id },
    );
    return { variables, source: "model" };
  } catch (err) {
    // Typically AnthropicNotConfigured / OfflineCassetteMissing. Never silent: the source is labeled.
    return {
      variables: templateVariables(ctx),
      source: "template",
      fallbackReason: err instanceof Error ? err.name : "unknown",
    };
  }
}

/**
 * An approved draft is immutable (M2): re-composing voids its approval, cancels it, and starts a fresh draft row
 * (with its own owner link). The reviewer must approve the new version.
 */
async function supersedeApprovedDraft(db: Db, old: Outreach): Promise<Outreach> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (old.approvalId) {
      await t.update(approvals).set({ consumedAt: new Date() }).where(and(eq(approvals.id, old.approvalId), isNull(approvals.consumedAt)));
    }
    await t
      .update(outreach)
      .set({ status: "cancelled", tracking: mergeTracking(old.tracking, { superseded: { at: new Date().toISOString(), reason: "recomposed after approval" } }) })
      .where(eq(outreach.id, old.id));
    const [created] = await t
      .insert(outreach)
      .values({ companyId: old.companyId, staleItemId: old.staleItemId, channel: old.channel, status: "draft" })
      .returning();
    return created!;
  });
}

/** Find the open draft for (staleItem, channel) or create one. */
export async function ensureDraftRow(db: Db, ctx: ItemContext, channel: Outreach["channel"]): Promise<Outreach> {
  const rows = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.staleItemId, ctx.stale.id), eq(outreach.channel, channel), inArray(outreach.status, [...EDITABLE_STATUSES])));
  const existing = rows[0];
  if (existing && existing.status !== "approved") return existing;
  if (existing) return supersedeApprovedDraft(db, existing);
  const sent = await db
    .select({ id: outreach.id })
    .from(outreach)
    .where(and(eq(outreach.staleItemId, ctx.stale.id), eq(outreach.channel, channel)));
  if (sent.length > 0) {
    throw new OutreachStateError("locked", `A ${channel} for this item was already sent or closed; refusing to draft another.`);
  }
  const [created] = await db
    .insert(outreach)
    .values({ companyId: ctx.company.id, staleItemId: ctx.stale.id, channel, status: "draft" })
    .returning();
  return created!;
}

export function mintOwnerUrl(
  outreachId: string,
  env: Env,
  nowDate: Date,
): { url: string; tokenHash: string; expiresAt: Date } | { error: string } {
  const expiresAt = new Date(nowDate.getTime() + OWNER_LINK_TTL_DAYS * 24 * 3600 * 1000);
  try {
    const { token, tokenHash } = createOwnerToken({ outreachId, expiresAt }, env.OWNER_LINK_SECRET);
    return { url: `${appBaseUrl(env)}/owner/${token}`, tokenHash, expiresAt };
  } catch (e) {
    if (e instanceof OwnerTokenConfigError) return { error: e.message };
    throw e;
  }
}

/** Compose the due-diligence letter for a stale item and persist it as the outreach draft body. */
export async function composeLetter(db: Db, staleItemId: string, deps: ComposeDeps = {}): Promise<ComposedLetter> {
  const env = deps.env ?? getEnv();
  const ctx = await loadItemContext(db, staleItemId);
  const row = await ensureDraftRow(db, ctx, "letter");
  const problems: string[] = [];
  const warnings: string[] = [];

  // Rule language: verbatim from the rule file or the UNKNOWN placeholder. Never invented.
  const state = ctx.stale.ownerState;
  let requiredLanguage: string | null = null;
  let languageTodo: string | null = null;
  let ruleVersion: string | null = null;
  let languageVerified = false;
  const letterDate = await clockNow(db, ctx.company.id);
  if (!state) {
    problems.push("owner state is unknown, so the state's required notice language cannot be chosen");
  } else {
    const rules = (deps.loadRules ?? tryLoadRules)(state);
    if (!rules) {
      problems.push(`no rule file for ${state}`);
    } else {
      const rv = rules.file.dueDiligence.requiredLanguage;
      ruleVersion = rules.file.version;
      languageVerified = rv.verified;
      languageTodo = rv.todo ?? null;
      if (rv.value === null) {
        problems.push(`required notice language for ${state} is UNKNOWN (rule TODO); letter is not ready`);
      } else {
        // Delaware's statute has a bracketed date slot; the date is computed by code, not the model.
        requiredLanguage = rv.value.replace(/\[insert date[^\]]*\]/i, longDate(addDays(letterDate, DE_NOTICE_DAYS)));
        if (/\[[^\]]*\]/.test(requiredLanguage)) problems.push("required notice language still contains an unfilled [bracketed] slot");
        if (!rv.verified) warnings.push(`${state} required-language rule value is UNVERIFIED`);
      }
      const min = rules.file.dueDiligence.minAmountCents.value;
      if (min !== null && ctx.stale.amountCents < min) {
        warnings.push(`amount is below ${state}'s due-diligence minimum (${formatUSD(min)}); a letter may not be required`);
      }
    }
  }

  if (!ctx.ownerAddress) problems.push("owner mailing address is missing or incomplete");
  const companyAddr = [ctx.company.addressLine, [ctx.company.city, ctx.company.hqState, ctx.company.zip].filter(Boolean).join(" ")].filter(
    (x): x is string => Boolean(x),
  );
  if (!ctx.company.addressLine || !ctx.company.city || !ctx.company.hqState || !ctx.company.zip) {
    problems.push("holder return address is missing or incomplete");
  }

  const minted = mintOwnerUrl(row.id, env, deps.nowDate ?? new Date());
  if ("error" in minted) problems.push(`owner response link unavailable: ${minted.error}`);
  const ownerUrl = "error" in minted ? null : minted.url;
  if (!env.APP_BASE_URL) warnings.push("APP_BASE_URL is not set; owner link uses http://localhost:3000");

  const { variables, source, fallbackReason } = await resolveVariables(ctx, deps, db);
  const oa = ctx.ownerAddress;
  const html = renderLetterHtml({
    holderName: ctx.company.name,
    holderAddressLines: companyAddr,
    ownerName: ctx.ownerName,
    ownerAddressLines: oa ? [oa.line1, `${oa.city}, ${oa.state} ${oa.zip}`] : ["[address missing]"],
    dateLabel: longDate(letterDate),
    requiredLanguage,
    requiredLanguageTodo: languageTodo,
    greeting: variables.greeting,
    itemDescription: variables.itemDescription,
    responseInstructions: variables.responseInstructions,
    itemRows: [
      { label: "Item", value: PROPERTY_LABEL[ctx.ledger.propertyType] ?? "payment" },
      { label: "Reference number", value: ctx.ledger.referenceNumber ?? "n/a" },
      { label: "Amount", value: formatUSD(ctx.stale.amountCents) },
      { label: "Issued", value: ctx.ledger.issueDate },
      { label: "Payable to", value: ctx.ownerName },
    ],
    responseUrl: ownerUrl ?? "[owner link unavailable]",
    variablesSource: source,
  });

  const readiness: Readiness = { ready: problems.length === 0, problems, warnings };
  const toAddress = oa
    ? JSON.stringify({
        name: ctx.ownerName,
        address_line1: oa.line1,
        address_city: oa.city,
        address_state: oa.state,
        address_zip: oa.zip,
      })
    : null;
  const [saved] = await db
    .update(outreach)
    .set({
      body: html,
      subject: `Due diligence notice${ctx.ledger.referenceNumber ? ` - item ${ctx.ledger.referenceNumber}` : ""}`.slice(0, 200),
      toAddress,
      tokenHash: "error" in minted ? null : minted.tokenHash,
      // Re-composing invalidates any earlier approval via the payload hash; reset the visible state.
      status: "draft",
      tracking: mergeTracking(row.tracking, {
        compose: {
          variables_source: source,
          variablesFallbackReason: fallbackReason ?? null,
          readiness,
          ruleVersion,
          requiredLanguageVerified: languageVerified,
          ownerLinkExpiresAt: "error" in minted ? null : minted.expiresAt.toISOString(),
          composedFor: letterDate,
        },
      }),
    })
    .where(eq(outreach.id, row.id))
    .returning();

  let payload: LetterPayload | null = null;
  if (readiness.ready) payload = buildLetterPayload(saved!, ctx.company);
  return { outreachId: row.id, html, payload, readiness, variablesSource: source, ownerUrl };
}

