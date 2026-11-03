import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type Outreach } from "@/db/schema";
import { DISCLAIMER } from "@/lib/disclaimer";
import { getEnv } from "@/lib/env";
import { formatUSD } from "@/lib/money";
import { now as clockNow } from "@/lib/clock";
import { tryLoadRules } from "@/lib/rules/load";
import { planBulkDraft, type DraftSkipCode, type PlanEntry, type PlanRuleLookup } from "./bulk-plan";
import { OutreachStateError } from "./errors";
import { composeLetter, ensureDraftRow, mintOwnerUrl, resolveOwnerBaseUrl, resolveVariables, type ComposeDeps, type Readiness } from "@/lib/letters/compose";
import { loadItemContext, PROPERTY_LABEL } from "@/lib/letters/context";
import { escapeHtml } from "@/lib/letters/template";
import { mergeTracking } from "./util";

/** The item is closed to outreach (HTTP 409, code `draft_refused`; the chat tool shows the message). */
export class DraftRefusedError extends OutreachStateError {
  constructor(message: string) {
    super("draft_refused", message);
    this.name = "DraftRefusedError";
  }
}

export interface DraftResult {
  outreachId: string;
  channel: Outreach["channel"];
  readiness: Readiness;
  variablesSource: "model" | "template";
}

/** Same required-language readiness the letter gets (composeLetter), read from the state's rule file; never invented. */
function noticeLanguageReadiness(state: string | null, deps: ComposeDeps): Pick<Readiness, "problems" | "warnings"> {
  if (!state) return { problems: ["owner state is unknown, so the state's required notice language cannot be chosen"], warnings: [] };
  const rules = (deps.loadRules ?? tryLoadRules)(state);
  if (!rules) return { problems: [`no rule file for ${state}`], warnings: [] };
  const rv = rules.file.dueDiligence.requiredLanguage;
  if (rv.value === null) {
    return { problems: [`required notice language for ${state} is UNKNOWN (rule TODO); email is not ready`], warnings: [] };
  }
  return { problems: [], warnings: rv.verified ? [] : [`${state} required-language rule value is UNVERIFIED`] };
}

/** Skip codes that make a draft refuse everywhere (drawer, chat, API, bulk). The other codes stay advisory. */
const REFUSING_CODES: readonly DraftSkipCode[] = ["closed", "window_not_open"];

/**
 * THE draft-eligibility check: the pure pre-flight bulk draft uses (planBulkDraft) run for one item. Bulk draft,
 * the drawer, the API and the chat tool all go through it (R3-04, R4-03), so none can contradict another.
 */
export async function checkDraftEligibility(db: Db, staleItemId: string, channel: Outreach["channel"], deps: ComposeDeps = {}): Promise<PlanEntry | undefined> {
  const ctx = await loadItemContext(db, staleItemId);
  const load = deps.loadRules ?? tryLoadRules;
  const rules: PlanRuleLookup = (state) => {
    const r = load(state);
    return r ? { requiredLanguage: r.file.dueDiligence.requiredLanguage.value } : null;
  };
  const today = await clockNow(db, ctx.stale.companyId);
  const [entry] = planBulkDraft(
    [
      {
        id: staleItemId,
        status: ctx.stale.status,
        ownerState: ctx.stale.ownerState,
        ddWindowStart: ctx.stale.ddWindowStart,
        hasOwnerAddress: ctx.ownerAddress !== null,
        existing: [],
      },
    ],
    today,
    rules,
    { channel },
  );
  return entry;
}

/**
 * Server-side guard for every single-item path. It refuses the "closed" outcome (paid, reported, remitted, or the
 * window has passed) and "window_not_open" (a notice sent before the due-diligence window opens may not count,
 * R4-03). The remaining skip codes stay advisory here (recomposing a blocked draft must keep working so its
 * readiness problems can be shown and fixed).
 */
export async function assertDraftable(db: Db, staleItemId: string, channel: Outreach["channel"], deps: ComposeDeps = {}): Promise<void> {
  const entry = await checkDraftEligibility(db, staleItemId, channel, deps);
  if (entry?.decision === "skip" && REFUSING_CODES.includes(entry.code)) throw new DraftRefusedError(entry.message);
}

async function composeEmail(db: Db, staleItemId: string, deps: ComposeDeps): Promise<DraftResult> {
  const env = deps.env ?? getEnv();
  const ctx = await loadItemContext(db, staleItemId);
  const row = await ensureDraftRow(db, ctx, "email");
  const minted = mintOwnerUrl(row.id, env, deps.nowDate ?? new Date(), await resolveOwnerBaseUrl(env, deps));
  const problems = "error" in minted ? [`owner response link unavailable: ${minted.error}`] : [];
  const { variables, source, fallbackReason } = await resolveVariables(ctx, deps, db);
  const url = "error" in minted ? "[owner link unavailable]" : minted.url;
  const html = `<!doctype html><html lang="en"><body style="font-family:system-ui,sans-serif;max-width:560px">
<p>${escapeHtml(variables.greeting)}</p>
<p>${escapeHtml(variables.itemDescription)}</p>
<p><a href="${escapeHtml(url)}">Respond online</a> to confirm your address or tell us the item was already paid:<br>${escapeHtml(url)}</p>
<p style="font-size:12px;color:#555">SYNTHETIC TEST EMAIL. ${escapeHtml(DISCLAIMER)}</p>
</body></html>`;
  const language = noticeLanguageReadiness(ctx.stale.ownerState, deps);
  problems.push(...language.problems);
  const readiness: Readiness = { ready: problems.length === 0, problems, warnings: language.warnings };
  await db
    .update(outreach)
    .set({
      body: html,
      subject: `Action needed: unclaimed payment from ${ctx.company.name}`.slice(0, 200),
      tokenHash: "error" in minted ? null : minted.tokenHash,
      status: "draft",
      tracking: mergeTracking(row.tracking, {
        compose: { variables_source: source, variablesFallbackReason: fallbackReason ?? null, readiness },
      }),
    })
    .where(eq(outreach.id, row.id));
  return { outreachId: row.id, channel: "email", readiness, variablesSource: source };
}

async function composeCallScript(db: Db, staleItemId: string): Promise<DraftResult> {
  const ctx = await loadItemContext(db, staleItemId);
  const row = await ensureDraftRow(db, ctx, "voice");
  const label = PROPERTY_LABEL[ctx.ledger.propertyType] ?? "payment";
  const script =
    `SIMULATED CALL (test). Hello, may I speak with ${ctx.ownerName}? This is an automated assistant calling for ${ctx.company.name}. ` +
    `We are holding a ${label}${ctx.ledger.referenceNumber ? ` number ${ctx.ledger.referenceNumber}` : ""} for ${formatUSD(ctx.stale.amountCents)} ` +
    `that has not been cashed. Could you confirm your current mailing address, or tell us if it was already paid? ` +
    `Do not give legal advice or make claims about what any state will do.`;
  const readiness: Readiness = { ready: true, problems: [], warnings: [] };
  await db
    .update(outreach)
    .set({
      body: script,
      subject: "Simulated call",
      status: "draft",
      tracking: mergeTracking(row.tracking, {
        simulated: true,
        compose: {
          variables_source: "template",
          readiness,
          dynamicVariables: {
            owner_name: ctx.ownerName,
            holder_name: ctx.company.name,
            amount: formatUSD(ctx.stale.amountCents),
            reference_number: ctx.ledger.referenceNumber ?? "",
          },
        },
      }),
    })
    .where(eq(outreach.id, row.id));
  return { outreachId: row.id, channel: "voice", readiness, variablesSource: "template" };
}

/** Compose (and persist as draft) the outreach for any channel. */
export async function draftOutreach(
  db: Db,
  staleItemId: string,
  channel: Outreach["channel"],
  deps: ComposeDeps = {},
): Promise<DraftResult> {
  await assertDraftable(db, staleItemId, channel, deps);
  if (channel === "letter") {
    const r = await composeLetter(db, staleItemId, deps);
    return { outreachId: r.outreachId, channel, readiness: r.readiness, variablesSource: r.variablesSource };
  }
  return channel === "email" ? composeEmail(db, staleItemId, deps) : composeCallScript(db, staleItemId);
}
