/**
 * "Lead with late money" (dogfood round 3, opportunity #2): how much is already late and how much audit interest it
 * is accruing, per state, plus which state's report a catch-up filing should start with. Pure: the overdue items come
 * from the shared overdue assessment (src/lib/overdue.ts via getOverdue) and the interest from the deterministic rules
 * engine (computeAuditInterest), the same function the dashboard's Audit-interest card uses. Nothing here invents a
 * rate: a state with no interest rule (or an unsupported basis) is `unknown`, never estimated.
 *
 * Interest only accrues on a late REPORT: items whose `report_due` obligation is overdue. Their days late are counted
 * from that deterministic report due date to the demo-clock date, exactly as the card counts them, so for a state the
 * two figures agree (items not yet due accrue 0 days on the card).
 */
import type { IsoDate } from "@/lib/dates";
import type { ObligationKind } from "@/lib/overdue";
import { computeAuditInterest } from "@/lib/rules/engine";
import type { RuleFile } from "../../../rules/schema";

/** States the app can generate and file a report for (mirrors SUPPORTED_REPORT_STATES; kept here so this stays pure). */
export const CATCH_UP_STATES: readonly string[] = ["CA", "DE", "TX"];

/** The slice of an OverdueItem this needs (getOverdue's items satisfy it structurally). */
export interface LateItemInput {
  itemId: string;
  state: string | null;
  amount: { cents: number };
  status: string;
  overdue: readonly { kind: ObligationKind; date: string; verified: boolean }[];
}

export type StateInterest =
  | { status: "ok"; cents: number; verified: boolean; ruleVersion: string }
  | { status: "unknown"; reason: string }
  /** No report is late in this state, so no late-report interest accrues (e.g. only a DD window closed). */
  | { status: "none" };

export interface StateLateMoney {
  state: string;
  /** Every overdue item in the state (any missed obligation). */
  count: number;
  cents: number;
  /** Items whose report is late: what a catch-up report addresses (a late remittance is not a report; see R3-07). */
  filingLateCount: number;
  filingLateCents: number;
  /** Of those, items in To Report: the ones a generated report will include. */
  inReportCount: number;
  interest: StateInterest;
}

export interface LateMoneySummary {
  lateCount: number;
  lateCents: number;
  /** Sum of the states whose interest is known; null when no state has a known figure. */
  interestCents: number | null;
  /** True only when every state with a known figure rests on verified rule values. */
  interestVerified: boolean;
  /** States with interest known (ok and > 0 days), for the "(TX, UNVERIFIED)" label. */
  interestStates: string[];
  /** States where a report is late but interest cannot be computed (no rule, unsupported basis, unknown state). */
  unknownInterestStates: string[];
  byState: StateLateMoney[];
  /** The supported state with the most late report money; null when no report is late. */
  catchUp: { state: string; count: number; cents: number; inReportCount: number } | null;
}

function stateInterest(state: string, items: readonly LateItemInput[], rules: RuleFile | null, asOf: IsoDate): StateInterest {
  const reportLate = items
    .map((i) => ({ i, due: i.overdue.find((o) => o.kind === "report_due") }))
    .filter((x): x is { i: LateItemInput; due: NonNullable<typeof x.due> } => Boolean(x.due));
  if (reportLate.length === 0) return { status: "none" };
  if (state === "Unknown") return { status: "unknown", reason: "Owner state unknown; interest cannot be estimated" };
  if (!rules) return { status: "unknown", reason: `No rule file for ${state}; interest is unknown` };
  const result = computeAuditInterest(
    reportLate.map(({ i, due }) => ({ id: i.itemId, amountCents: i.amount.cents, reportDueDate: due.date as IsoDate })),
    rules,
    asOf,
  );
  if (result.status !== "ok" || result.totalCents === null) {
    return { status: "unknown", reason: result.notes[0] ?? `${state} has no interest rule` };
  }
  return { status: "ok", cents: result.totalCents, verified: result.verified, ruleVersion: rules.version };
}

/**
 * @param items overdue items (getOverdue().items).
 * @param rulesFor the current rule file for a state, or null when there is none (tryLoadRules(state)?.file ?? null).
 * @param asOf the demo-clock date the overdue assessment used.
 */
export function summarizeLateMoney(items: readonly LateItemInput[], rulesFor: (state: string) => RuleFile | null, asOf: IsoDate): LateMoneySummary {
  const groups = new Map<string, LateItemInput[]>();
  for (const i of items) {
    const k = i.state ?? "Unknown";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const byState: StateLateMoney[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, list]) => {
      const filing = list.filter((i) => i.overdue.some((o) => o.kind === "report_due"));
      return {
        state,
        count: list.length,
        cents: list.reduce((a, i) => a + i.amount.cents, 0),
        filingLateCount: filing.length,
        filingLateCents: filing.reduce((a, i) => a + i.amount.cents, 0),
        inReportCount: filing.filter((i) => i.status === "to_report").length,
        interest: stateInterest(state, list, state === "Unknown" ? null : rulesFor(state), asOf),
      };
    });

  const known = byState.filter((s): s is StateLateMoney & { interest: Extract<StateInterest, { status: "ok" }> } => s.interest.status === "ok");
  const catchUpState = byState
    .filter((s) => CATCH_UP_STATES.includes(s.state) && s.filingLateCount > 0)
    .sort((a, b) => b.filingLateCents - a.filingLateCents || a.state.localeCompare(b.state))[0];
  return {
    lateCount: items.length,
    lateCents: items.reduce((a, i) => a + i.amount.cents, 0),
    interestCents: known.length > 0 ? known.reduce((a, s) => a + s.interest.cents, 0) : null,
    interestVerified: known.length > 0 && known.every((s) => s.interest.verified),
    interestStates: known.map((s) => s.state),
    unknownInterestStates: byState.filter((s) => s.interest.status === "unknown").map((s) => s.state),
    byState,
    catchUp: catchUpState
      ? { state: catchUpState.state, count: catchUpState.filingLateCount, cents: catchUpState.filingLateCents, inReportCount: catchUpState.inReportCount }
      : null,
  };
}

/** Deep link that opens a state's report in catch-up mode (Reports auto-generates once, then stops at Approve). */
export function catchUpHref(state: string): string {
  return `/reports?state=${encodeURIComponent(state)}&catchup=1`;
}
