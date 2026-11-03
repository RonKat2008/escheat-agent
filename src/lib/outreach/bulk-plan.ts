import type { Outreach, StaleItem } from "@/db/schema";
import { compare, isIsoDate, type IsoDate } from "@/lib/dates";

/**
 * Pure pre-flight for bulk drafting. It decides nothing about the law: every date comes from the stale item's
 * stored, rules-engine-derived columns, and every rule value comes from the rule lookup the caller passes in.
 * A missing value is reported as missing, never guessed.
 */

export type DraftSkipCode =
  | "rule_unknown"
  | "window_not_open"
  | "already_drafted"
  | "closed"
  | "missing_owner_address"
  | "owner_state_unknown"
  | "not_found";

export interface PlanItem {
  id: string;
  status: StaleItem["status"];
  ownerState: string | null;
  /** Rules-engine due-diligence window start; null when no rule produced one. */
  ddWindowStart: string | null;
  /** True when a complete owner mailing address is on file (payee or ledger row). */
  hasOwnerAddress: boolean;
  /** Existing outreach rows for the same item and channel. */
  existing: Pick<Outreach, "status">[];
}

/** What the plan needs to know about one state's rule file. `requiredLanguage` null means UNKNOWN in the rule file. */
export interface PlanRule {
  requiredLanguage: string | null;
}

/** Returns the state's rules, or null when there is no rule file for it. */
export type PlanRuleLookup = (state: string) => PlanRule | null;

export interface SkipDetail {
  /** rule_unknown: the rule value that is missing, for example "dueDiligence.requiredLanguage". */
  rule?: string;
  state?: string;
  /** window_not_open: the ISO date the window opens. */
  opensOn?: string;
}

export type PlanEntry =
  | { staleItemId: string; decision: "will_draft" }
  | { staleItemId: string; decision: "skip"; code: DraftSkipCode; message: string; detail: SkipDetail };

export interface PlanSummary {
  total: number;
  willDraft: number;
  skipped: number;
  /** Count per skip code (only codes that occurred). */
  byReason: Partial<Record<DraftSkipCode, number>>;
}

const CLOSED_LABEL: Partial<Record<StaleItem["status"], string>> = {
  resolved_paid: "resolved as paid",
  reported: "already reported",
  remitted: "already remitted",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "May 2, 2030" from an ISO date; the raw string when it is not one. */
export function humanDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${d}, ${y}`;
}

const skip = (staleItemId: string, code: DraftSkipCode, message: string, detail: SkipDetail = {}): PlanEntry => ({
  staleItemId,
  decision: "skip",
  code,
  message,
  detail,
});

/**
 * The R4-03 gate on its own: `window_not_open` while the item's due-diligence window has not opened yet, else null.
 * planOne reports an earlier advisory code (rule_unknown, owner_state_unknown) first; the single-item draft guard
 * still applies this check so an advisory code never hides an unopened window (draft.ts assertDraftable).
 */
export function windowNotOpen(item: Pick<PlanItem, "id" | "ddWindowStart" | "ownerState">, now: IsoDate): PlanEntry | null {
  if (!item.ddWindowStart || compare(item.ddWindowStart as IsoDate, now) <= 0) return null;
  return skip(
    item.id,
    "window_not_open",
    `Due-diligence window opens on ${humanDate(item.ddWindowStart)}. A notice sent earlier may not count.`,
    { opensOn: item.ddWindowStart, ...(item.ownerState ? { state: item.ownerState } : {}) },
  );
}

function planOne(item: PlanItem, now: IsoDate, rules: PlanRuleLookup, channel: Outreach["channel"]): PlanEntry {
  const closed = CLOSED_LABEL[item.status];
  if (closed) return skip(item.id, "closed", `Item is ${closed}; no outreach needed.`);
  if (item.status === "to_report") {
    return skip(item.id, "closed", "Due-diligence window has passed; the item is in the report queue.");
  }
  if (item.existing.some((o) => o.status === "draft" || o.status === "awaiting_approval")) {
    return skip(item.id, "already_drafted", `A ${channel} draft is already waiting in Approvals.`);
  }
  if (item.existing.some((o) => o.status === "approved")) {
    return skip(item.id, "already_drafted", `A ${channel} is already approved. Recompose it from Approvals if it must change.`);
  }
  if (item.existing.length > 0) {
    return skip(item.id, "already_drafted", `A ${channel} was already sent or closed for this item.`);
  }
  if (item.status === "needs_rule") {
    return skip(item.id, "rule_unknown", "No usable rule for this state yet, so the notice cannot be prepared.", {
      rule: "dueDiligence",
      ...(item.ownerState ? { state: item.ownerState } : {}),
    });
  }
  const state = item.ownerState;
  if (!state) {
    return skip(item.id, "owner_state_unknown", "Owner state is unknown, so the required notice language cannot be chosen.");
  }
  if (channel === "letter") {
    const r = rules(state);
    if (!r) {
      return skip(item.id, "rule_unknown", `No rule file for ${state}, so the required notice language is unknown.`, { rule: "ruleFile", state });
    }
    if (r.requiredLanguage === null) {
      return skip(
        item.id,
        "rule_unknown",
        `Required notice language for ${state} is UNKNOWN in the rules. Research and approve it in Rules before drafting.`,
        { rule: "dueDiligence.requiredLanguage", state },
      );
    }
  }
  const notOpen = windowNotOpen(item, now);
  if (notOpen) return notOpen;
  if (channel === "letter" && !item.hasOwnerAddress) {
    return skip(item.id, "missing_owner_address", "Owner mailing address is missing or incomplete, so a letter cannot be mailed.");
  }
  return { staleItemId: item.id, decision: "will_draft" };
}

/**
 * For each item: `will_draft`, or `skip` with a machine code, human copy and structured detail.
 * Precedence (first match wins): closed, already_drafted, rule_unknown, owner_state_unknown, window_not_open,
 * missing_owner_address. Output order matches input order. `rules` is only consulted for letters.
 */
export function planBulkDraft(
  items: readonly PlanItem[],
  now: IsoDate,
  rules: PlanRuleLookup,
  opts: { channel?: Outreach["channel"] } = {},
): PlanEntry[] {
  const channel = opts.channel ?? "letter";
  return items.map((i) => planOne(i, now, rules, channel));
}

export function summarizePlan(plan: readonly PlanEntry[]): PlanSummary {
  const byReason: PlanSummary["byReason"] = {};
  let willDraft = 0;
  for (const e of plan) {
    if (e.decision === "will_draft") willDraft += 1;
    else byReason[e.code] = (byReason[e.code] ?? 0) + 1;
  }
  return { total: plan.length, willDraft, skipped: plan.length - willDraft, byReason };
}
