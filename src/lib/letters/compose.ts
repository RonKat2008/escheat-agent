import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, outreach, outreachItems, type Outreach } from "@/db/schema";
import { draftLetterVariables, type LetterVariables } from "@/lib/agents/letter-writer";
import type { ClassifierItem } from "@/lib/agents/types";
import { now as clockNow } from "@/lib/clock";
import { addDays, type IsoDate } from "@/lib/dates";
import { getEnv, isOffline, type Env } from "@/lib/env";
import { formatUSD } from "@/lib/money";
import { createOwnerToken, OwnerTokenConfigError, usingDevFallbackSecret } from "@/lib/outreach/tokens";
import { OutreachStateError } from "@/lib/outreach/errors";
import { buildLetterPayload, type LetterPayload } from "@/lib/outreach/payloads";
import { baseUrlFrom, currentRequestOrigin } from "@/lib/outreach/origin";
import { EDITABLE_STATUSES, mergeTracking } from "@/lib/outreach/util";
import { tryLoadRules } from "@/lib/rules/load";
import { ownerFacingLanguage } from "@/lib/rules/owner-text";
import { compareNoticeItems, itemNoun, noticeKey, totalCents } from "@/lib/outreach/consolidate";
import { kindOf, loadItemContext, PROPERTY_LABEL, type ItemContext } from "./context";
import { coveredStaleItemIds, findOpenNoticeCovering, loadNoticeItems, setNoticeItems } from "./notice-items";
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
  /** Owner-link base URL override (tests). Otherwise APP_BASE_URL, then the request origin, then localhost:$PORT. */
  baseUrl?: string;
}

export const OWNER_LINK_TTL_DAYS = 90;
export const DE_NOTICE_DAYS = 30;

/**
 * What produced the letter variables (R8-18): "model" = a live model call; "replay" = a recorded model response played
 * back in offline mode (no model was called now); "template" = the deterministic template (no model output at all).
 */
export type VariablesSource = "model" | "replay" | "template";

export interface ComposedLetter {
  outreachId: string;
  html: string;
  payload: LetterPayload | null;
  readiness: Readiness;
  variablesSource: VariablesSource;
  /** The plaintext owner link embedded in the letter (also in the HTML). */
  ownerUrl: string | null;
}

/** "Austin, TX 78701" from whatever parts exist. */
function cityStateZip(c: { city: string | null; hqState: string | null; zip: string | null }): string {
  const region = [c.hqState, c.zip].filter(Boolean).join(" ");
  return [c.city, region].filter(Boolean).join(", ");
}

const longDate = (d: IsoDate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Deterministic variable parts. Contains no legal claims; used when the model is unavailable. */
export function templateVariables(ctx: ItemContext): LetterVariables {
  const label = PROPERTY_LABEL[ctx.ledger.propertyType] ?? "payment";
  const ref = ctx.ledger.referenceNumber ? ` ${ctx.ledger.referenceNumber}` : "";
  return {
    greeting: `Dear ${ctx.ownerName},`,
    itemDescription: `${ctx.company.name} issued ${label}${ref} for ${formatUSD(ctx.stale.amountCents)} on ${longDate(ctx.ledger.issueDate as IsoDate)}. Our records show it has not been ${kindOf(ctx.ledger.propertyType) === "check" ? "cashed" : "applied"} or claimed.`,
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
): Promise<{ variables: LetterVariables; source: VariablesSource; fallbackReason?: string }> {
  const draft = deps.draftVariables ?? draftLetterVariables;
  try {
    const variables = await draft(
      toClassifierItem(ctx),
      { name: ctx.ownerName, address: ctx.ownerAddress?.line1 ?? null },
      { name: ctx.company.name, contact: ctx.company.addressLine },
      { db, subjectId: ctx.stale.id, companyId: ctx.company.id, staleItemId: ctx.stale.id },
    );
    // Offline mode only ever replays a recorded response; calling that "model" would claim a call that never happened.
    return { variables, source: isOffline(deps.env ?? getEnv()) ? "replay" : "model" };
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
  const prior = await db
    .select({ status: outreach.status, tracking: outreach.tracking })
    .from(outreach)
    .where(and(eq(outreach.staleItemId, ctx.stale.id), eq(outreach.channel, channel)));
  // A discarded (cancelled) draft never blocks a new one: nothing was sent and the item is free to get a new draft.
  // A letter folded into the owner's combined notice is also cancelled, but that notice covers it, so it still blocks.
  const blocking = prior.filter((r) => r.status !== "cancelled" || typeof r.tracking?.consolidatedInto === "string");
  if (blocking.length > 0) {
    throw new OutreachStateError("locked", `A ${channel} for this item was already sent or closed; refusing to draft another.`);
  }
  const [created] = await db
    .insert(outreach)
    .values({ companyId: ctx.company.id, staleItemId: ctx.stale.id, channel, status: "draft" })
    .returning();
  return created!;
}

/** Resolve the owner-link base URL once per compose: override, APP_BASE_URL, request origin, then localhost:$PORT. */
export async function resolveOwnerBaseUrl(env: Env, deps: { baseUrl?: string }): Promise<string> {
  if (deps.baseUrl) return deps.baseUrl;
  // The Host header is client-controlled, so only local dev trusts it; a deployment must set APP_BASE_URL.
  const trustRequestOrigin = !env.APP_BASE_URL?.trim() && process.env.NODE_ENV === "development";
  const requestOrigin = trustRequestOrigin ? await currentRequestOrigin() : null;
  return baseUrlFrom({ appBaseUrl: env.APP_BASE_URL, requestOrigin, port: process.env.PORT });
}

export function mintOwnerUrl(
  outreachId: string,
  env: Env,
  nowDate: Date,
  baseUrl?: string,
): { url: string; tokenHash: string; expiresAt: Date } | { error: string } {
  const expiresAt = new Date(nowDate.getTime() + OWNER_LINK_TTL_DAYS * 24 * 3600 * 1000);
  try {
    const { token, tokenHash } = createOwnerToken({ outreachId, expiresAt }, env.OWNER_LINK_SECRET);
    return { url: `${baseUrl ?? baseUrlFrom({ appBaseUrl: env.APP_BASE_URL, port: process.env.PORT })}/owner/${token}`, tokenHash, expiresAt };
  } catch (e) {
    if (e instanceof OwnerTokenConfigError) return { error: e.message };
    throw e;
  }
}

/** Compose the due-diligence letter for a stale item and persist it as the outreach draft body. */
/** Statutory text for one state, verbatim from its rule file (or the UNKNOWN marker). Never invented. */
interface NoticeLanguage {
  requiredLanguage: string | null;
  languageTodo: string | null;
  ruleVersion: string | null;
  languageVerified: boolean;
  /** The rule file's due-diligence minimum, integer cents, when it has one. */
  minAmountCents: number | null;
  problems: string[];
  warnings: string[];
}

function noticeLanguage(state: string | null, letterDate: IsoDate, deps: ComposeDeps): NoticeLanguage {
  const out: NoticeLanguage = { requiredLanguage: null, languageTodo: null, ruleVersion: null, languageVerified: false, minAmountCents: null, problems: [], warnings: [] };
  if (!state) {
    out.problems.push("owner state is unknown, so the state's required notice language cannot be chosen");
    return out;
  }
  const rules = (deps.loadRules ?? tryLoadRules)(state);
  if (!rules) {
    out.problems.push(`no rule file for ${state}`);
    return out;
  }
  const rv = rules.file.dueDiligence.requiredLanguage;
  out.ruleVersion = rules.file.version;
  out.languageVerified = rv.verified;
  out.languageTodo = rv.todo ?? null;
  out.minAmountCents = rules.file.dueDiligence.minAmountCents.value;
  // R4-01: print the human-approved owner-facing sentence, or a value that already speaks to the owner; never
  // holder-addressed statute text ("You (the holder) are holding the property").
  const lang = ownerFacingLanguage(rv);
  if (rv.value === null) {
    out.problems.push(`required notice language for ${state} is UNKNOWN (rule TODO); letter is not ready`);
  } else if (lang.text === null) {
    out.problems.push(`required notice language for ${state} is addressed to the holder; approve the owner-facing sentence on the Rules page`);
  } else {
    // Delaware's statute has a bracketed date slot; the date is computed by code, not the model.
    out.requiredLanguage = lang.text.replace(/\[insert date[^\]]*\]/i, longDate(addDays(letterDate, DE_NOTICE_DAYS)));
    if (/\[[^\]]*\]/.test(out.requiredLanguage)) out.problems.push("required notice language still contains an unfilled [bracketed] slot");
    if (!rv.verified) out.warnings.push(`${state} required-language rule value is UNVERIFIED`);
  }
  return out;
}

/** Deterministic wording for a letter that lists several items. No legal claims; the model is not used. */
export function noticeVariables(ctxs: readonly ItemContext[]): LetterVariables {
  const lead = ctxs[0]!;
  const allChecks = ctxs.every((c) => kindOf(c.ledger.propertyType) === "check");
  const noun = itemNoun(ctxs.length, allChecks);
  const total = formatUSD(totalCents(ctxs.map((c) => ({ amountCents: c.stale.amountCents }))));
  return {
    greeting: `Dear ${lead.ownerName},`,
    itemDescription: `${lead.company.name} is holding ${ctxs.length} ${noun} payable to you, totaling ${total}. Each one is listed below. Our records show ${ctxs.length === 1 ? "it has" : "they have"} not been ${allChecks ? "cashed" : "applied"} or claimed.`,
    responseInstructions:
      "Please confirm your current mailing address, or let us know if any of these items was already paid, using the online link below or the contact details in this letter. One reply covers every item listed.",
  };
}

/** The open letter row for the notice, superseding an approved one (M2) or creating it. */
async function noticeRow(db: Db, lead: ItemContext): Promise<Outreach> {
  const covering = await findOpenNoticeCovering(db, lead.stale.id);
  if (covering && covering.staleItemId === lead.stale.id) {
    return covering.status === "approved" ? supersedeApprovedDraft(db, covering) : covering;
  }
  return ensureDraftRow(db, lead, "letter");
}

/**
 * Close every other open letter for the items this notice now lists: it is replaced by the notice. An approval on a
 * replaced letter is voided. Cancelled rows carry `consolidatedInto` so the queue can hide them.
 */
async function absorbOtherLetters(db: Db, noticeId: string, staleItemIds: readonly string[]): Promise<string[]> {
  if (staleItemIds.length === 0) return [];
  const direct = await db
    .select()
    .from(outreach)
    .where(and(inArray(outreach.staleItemId, [...staleItemIds]), eq(outreach.channel, "letter"), inArray(outreach.status, [...EDITABLE_STATUSES])));
  const viaItems = await db
    .select({ o: outreach })
    .from(outreachItems)
    .innerJoin(outreach, eq(outreach.id, outreachItems.outreachId))
    .where(and(inArray(outreachItems.staleItemId, [...staleItemIds]), eq(outreach.channel, "letter"), inArray(outreach.status, [...EDITABLE_STATUSES])));
  const others = new Map<string, Outreach>();
  for (const o of [...direct, ...viaItems.map((r) => r.o)]) if (o.id !== noticeId) others.set(o.id, o);
  for (const old of others.values()) {
    if (old.approvalId) {
      await db.update(approvals).set({ consumedAt: new Date() }).where(and(eq(approvals.id, old.approvalId), isNull(approvals.consumedAt)));
    }
    await db
      .update(outreach)
      .set({
        status: "cancelled",
        tracking: mergeTracking(old.tracking, { consolidatedInto: noticeId, superseded: { at: new Date().toISOString(), reason: "combined into one notice for this owner" } }),
      })
      .where(eq(outreach.id, old.id));
  }
  return [...others.keys()];
}

/** Every listed item must belong to the same company, owner and state: one notice never mixes states. */
function assertOneNotice(ctxs: readonly ItemContext[]): void {
  const key = (c: ItemContext) => `${c.company.id}|${noticeKey({ ownerPayeeId: c.stale.ownerPayeeId ?? c.ledger.payeeId, state: c.stale.ownerState, staleItemId: c.stale.id })}`;
  const first = key(ctxs[0]!);
  if (ctxs.length > 1 && (first.includes("|solo:") || ctxs.some((c) => key(c) !== first))) {
    throw new OutreachStateError("not_one_owner", "These items do not share one owner and one state, so they cannot be combined into one notice.");
  }
}

/**
 * Compose ONE due-diligence letter that lists every given item (one notice per owner and state). The first id is the
 * lead item: the letter row lives on it. With a single id this is the plain single-item letter. The statutory text
 * comes only from that state's rule file; the item list and total are code, never the model.
 */
export async function composeNotice(db: Db, staleItemIds: readonly string[], deps: ComposeDeps = {}): Promise<ComposedLetter> {
  if (staleItemIds.length === 0) throw new RangeError("composeNotice needs at least one item");
  const ids = [...new Set(staleItemIds)];
  const ctxs = await Promise.all(ids.map((id) => loadItemContext(db, id)));
  assertOneNotice(ctxs);
  const lead = ctxs[0]!;
  const multi = ctxs.length > 1;
  const env = deps.env ?? getEnv();
  const row = multi ? await noticeRow(db, lead) : await ensureDraftRow(db, lead, "letter");
  const letterDate = await clockNow(db, lead.company.id);
  const lang = noticeLanguage(lead.stale.ownerState, letterDate, deps);
  const problems = [...lang.problems];
  const warnings = [...lang.warnings];
  const ordered = multi ? [...ctxs].sort((a, b) => compareNoticeItems(candidateOf(a), candidateOf(b))) : ctxs;
  const total = totalCents(ordered.map((c) => ({ amountCents: c.stale.amountCents })));
  const state = lead.stale.ownerState;
  if (lang.minAmountCents !== null && state && total < lang.minAmountCents) {
    warnings.push(`amount is below ${state}'s due-diligence minimum (${formatUSD(lang.minAmountCents)}); a letter may not be required`);
  }

  if (!lead.ownerAddress) problems.push("owner mailing address is missing or incomplete");
  const companyAddr = [lead.company.addressLine, cityStateZip(lead.company)].filter((x): x is string => Boolean(x));
  if (!lead.company.addressLine || !lead.company.city || !lead.company.hqState || !lead.company.zip) {
    problems.push("holder return address is missing or incomplete");
  }

  const minted = mintOwnerUrl(row.id, env, deps.nowDate ?? new Date(), await resolveOwnerBaseUrl(env, deps));
  if ("error" in minted) problems.push(`owner response link unavailable: ${minted.error}`);
  const ownerUrl = "error" in minted ? null : minted.url;
  if (!("error" in minted) && usingDevFallbackSecret(env.OWNER_LINK_SECRET)) {
    warnings.push("OWNER_LINK_SECRET is not set; the owner link is signed with a temporary dev secret and stops working when the dev server restarts");
  }
  if (!env.APP_BASE_URL) warnings.push("APP_BASE_URL is not set; the owner link uses the address this app is being served from");

  const resolved = multi ? { variables: noticeVariables(ordered), source: "template" as const, fallbackReason: "consolidated" } : await resolveVariables(lead, deps, db);
  const { variables, source, fallbackReason } = resolved;
  const oa = lead.ownerAddress;
  const allChecks = ordered.every((c) => kindOf(c.ledger.propertyType) === "check");
  const html = renderLetterHtml({
    holderName: lead.company.name,
    holderAddressLines: companyAddr,
    ownerName: lead.ownerName,
    ownerAddressLines: oa ? [oa.line1, `${oa.city}, ${oa.state} ${oa.zip}`] : ["[address missing]"],
    dateLabel: longDate(letterDate),
    requiredLanguage: lang.requiredLanguage,
    requiredLanguageTodo: lang.languageTodo,
    greeting: variables.greeting,
    itemDescription: variables.itemDescription,
    responseInstructions: variables.responseInstructions,
    itemRows: multi
      ? [
          { label: "Payable to", value: lead.ownerName },
          { label: "Items", value: `${ordered.length} ${itemNoun(ordered.length, allChecks)}` },
          { label: "Total", value: formatUSD(total) },
        ]
      : [
          { label: "Item", value: PROPERTY_LABEL[lead.ledger.propertyType] ?? "payment" },
          { label: "Reference number", value: lead.ledger.referenceNumber ?? "n/a" },
          { label: "Amount", value: formatUSD(lead.stale.amountCents) },
          { label: "Issued", value: longDate(lead.ledger.issueDate as IsoDate) },
          { label: "Payable to", value: lead.ownerName },
        ],
    itemList: multi
      ? {
          columns: [allChecks ? "Check number" : "Reference number", "Issued", "Amount"],
          rows: ordered.map((c) => [c.ledger.referenceNumber ? `#${c.ledger.referenceNumber}` : "n/a", longDate(c.ledger.issueDate as IsoDate), formatUSD(c.stale.amountCents)]),
          totalLabel: "Total",
          total: formatUSD(total),
        }
      : null,
    responseUrl: ownerUrl ?? "[owner link unavailable]",
    variablesSource: source,
  });

  const readiness: Readiness = { ready: problems.length === 0, problems, warnings };
  const toAddress = oa
    ? JSON.stringify({ name: lead.ownerName, address_line1: oa.line1, address_city: oa.city, address_state: oa.state, address_zip: oa.zip })
    : null;
  const subject = multi
    ? `Due diligence notice - ${ordered.length} ${itemNoun(ordered.length, allChecks)}`
    : `Due diligence notice${lead.ledger.referenceNumber ? ` - item ${lead.ledger.referenceNumber}` : ""}`;
  const [saved] = await db
    .update(outreach)
    .set({
      body: html,
      subject: subject.slice(0, 200),
      toAddress,
      tokenHash: "error" in minted ? null : minted.tokenHash,
      // Re-composing invalidates any earlier approval via the payload hash; reset the visible state.
      status: "draft",
      tracking: mergeTracking(row.tracking, {
        compose: {
          variables_source: source,
          variablesFallbackReason: fallbackReason ?? null,
          readiness,
          ruleVersion: lang.ruleVersion,
          requiredLanguageVerified: lang.languageVerified,
          ownerLinkExpiresAt: "error" in minted ? null : minted.expiresAt.toISOString(),
          composedFor: letterDate,
        },
        notice: { itemCount: ordered.length, totalCents: total },
      }),
    })
    .where(eq(outreach.id, row.id))
    .returning();
  await setNoticeItems(db, row.id, multi ? ordered.map((c) => ({ staleItemId: c.stale.id, amountCents: c.stale.amountCents })) : []);
  if (multi) await absorbOtherLetters(db, row.id, ordered.map((c) => c.stale.id));

  let payload: LetterPayload | null = null;
  if (readiness.ready) payload = buildLetterPayload(saved!, lead.company, await loadNoticeItems(db, saved!));
  return { outreachId: row.id, html, payload, readiness, variablesSource: source, ownerUrl };
}

function candidateOf(c: ItemContext) {
  return {
    outreachId: "",
    staleItemId: c.stale.id,
    ownerPayeeId: c.stale.ownerPayeeId ?? c.ledger.payeeId,
    state: c.stale.ownerState,
    referenceNumber: c.ledger.referenceNumber,
    issueDate: c.ledger.issueDate,
    amountCents: c.stale.amountCents,
    itemCount: 1,
  };
}

/**
 * Compose the due-diligence letter for a stale item and persist it as the outreach draft body. When the item is
 * already listed in its owner's combined notice, that whole notice is recomposed (one notice per owner).
 */
export async function composeLetter(db: Db, staleItemId: string, deps: ComposeDeps = {}): Promise<ComposedLetter> {
  const notice = await findOpenNoticeCovering(db, staleItemId);
  if (notice) {
    const ids = await coveredStaleItemIds(db, notice);
    if (ids.length > 1) return composeNotice(db, [notice.staleItemId, ...ids.filter((id) => id !== notice.staleItemId)], deps);
  }
  return composeNotice(db, [staleItemId], deps);
}
