/**
 * Overdue obligations (R2-02). The ONE place that decides whether an item is late. Pure: no I/O, no clock reads, no
 * date arithmetic beyond comparing the deterministic dates the rules engine already produced with "today" (the demo
 * clock). Every page, the forecast and the calendar feed call this instead of comparing dates themselves.
 *
 * Honesty rules:
 *  - A date the engine could not compute (status `unknown`, e.g. a missing rule value) never makes an item overdue.
 *    It is reported in `unknown` so the UI can say "date unknown" instead.
 *  - `not_applicable` (e.g. no due diligence below the minimum amount) is not an obligation at all.
 *  - A date equal to today is due today, not overdue. Overdue means strictly before today.
 *  - An obligation that was met (paid back, remitted, the report filed, or the letter went out) is not overdue.
 *    A reported item still owes its remittance, so a passed remit date makes it overdue.
 *  - Each overdue obligation keeps the engine's `verified` flag, so an UNVERIFIED rule value stays marked.
 */
import { compare, diffDays, type IsoDate } from "@/lib/dates";

export type ObligationKind = "dd_window_end" | "report_due" | "remit_due";

export type ItemStatus =
  | "watching"
  | "dd_pending"
  | "dd_sent"
  | "owner_responded"
  | "resolved_paid"
  | "to_report"
  | "reported"
  | "remitted"
  | "needs_rule";

export const OBLIGATION_LABEL: Record<ObligationKind, string> = {
  dd_window_end: "Due diligence window closed",
  report_due: "Report due",
  remit_due: "Remit due",
};

/** One deadline as the engine (or the persisted engine output) gives it. */
export interface ObligationDate {
  kind: ObligationKind;
  /** Null when the engine could not compute it, or when it does not apply. */
  date: string | null;
  /** Engine status. Defaults to `ok` when a date is present and `unknown` when it is not. */
  status?: "ok" | "unknown" | "not_applicable";
  verified: boolean;
  /** Report stage name (CA has a notice and a remit stage), for display. */
  stage?: string | null;
}

export interface OverdueInput {
  status: ItemStatus;
  obligations: readonly ObligationDate[];
}

export interface OverdueObligation {
  kind: ObligationKind;
  date: IsoDate;
  daysLate: number;
  verified: boolean;
  stage: string | null;
}

export type OverdueState = "overdue" | "date_unknown" | "on_track" | "done";

export interface OverdueAssessment {
  state: OverdueState;
  /** Missed obligations, earliest first. Empty unless state is `overdue`. */
  overdue: OverdueObligation[];
  /** Pending obligations whose date is unknown (never counted as overdue). */
  unknown: ObligationKind[];
  /** The earliest missed obligation, or null. */
  earliest: OverdueObligation | null;
  /** Days since the earliest missed obligation (0 when not overdue). */
  daysLate: number;
  /** True when every missed obligation rests on verified rule values. */
  verified: boolean;
}

/** Nothing left to do: paid back to the owner, or remitted to the state. */
const DONE: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["resolved_paid", "remitted"]);
/**
 * Filed with the state but the money has not moved. The report (and the DD letter) are satisfied; the remittance is
 * still owed. The app has no remittance step that sets `remitted` (R3-07), so "reported, remit date passed" is
 * overdue until one exists.
 */
const FILED: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["reported"]);
/** The due-diligence letter is still owed only before it was sent (or answered, or the item moved to reporting). */
const DD_OWED: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["watching", "dd_pending", "needs_rule"]);

const ORDER: Record<ObligationKind, number> = { dd_window_end: 0, report_due: 1, remit_due: 2 };

/** Is this obligation still owed for an item in this status? */
export function obligationPending(kind: ObligationKind, status: ItemStatus): boolean {
  if (DONE.has(status)) return false;
  if (FILED.has(status)) return kind === "remit_due";
  return kind === "dd_window_end" ? DD_OWED.has(status) : true;
}

/** True when `date` is strictly before `today`. A date due today is not late. */
export function isPastDue(date: string, today: IsoDate): boolean {
  return compare(date as IsoDate, today) < 0;
}

export function assessOverdue(input: OverdueInput, today: IsoDate): OverdueAssessment {
  if (DONE.has(input.status)) {
    return { state: "done", overdue: [], unknown: [], earliest: null, daysLate: 0, verified: true };
  }
  const overdue: OverdueObligation[] = [];
  const unknown: ObligationKind[] = [];
  for (const o of input.obligations) {
    if (!obligationPending(o.kind, input.status)) continue;
    const status = o.status ?? (o.date ? "ok" : "unknown");
    if (status === "not_applicable") continue;
    if (status === "unknown" || !o.date) {
      if (!unknown.includes(o.kind)) unknown.push(o.kind);
      continue;
    }
    if (!isPastDue(o.date, today)) continue;
    overdue.push({ kind: o.kind, date: o.date as IsoDate, daysLate: diffDays(o.date as IsoDate, today), verified: o.verified, stage: o.stage ?? null });
  }
  overdue.sort((a, b) => compare(a.date, b.date) || ORDER[a.kind] - ORDER[b.kind]);
  const earliest = overdue[0] ?? null;
  const state: OverdueState = earliest ? "overdue" : unknown.length > 0 ? "date_unknown" : "on_track";
  return { state, overdue, unknown, earliest, daysLate: earliest?.daysLate ?? 0, verified: overdue.every((o) => o.verified) };
}

/** Persisted engine output on a stale item (DB columns). */
export interface PersistedDates {
  status: ItemStatus;
  ddWindowEnd: string | null;
  reportDueDate: string | null;
  remitDueDate: string | null;
  reportStage?: string | null;
  dependsOnUnverified: boolean;
}

/**
 * The same assessment from the dates persisted on a stale item. A null report or remit date is UNKNOWN (the schema
 * stores null for a missing rule, never a guess). A null DD window close is treated as not applicable: the engine
 * stores null both when due diligence does not apply and when it is unknown, and an item never becomes overdue on it.
 */
export function assessPersisted(row: PersistedDates, today: IsoDate): OverdueAssessment {
  const verified = !row.dependsOnUnverified;
  return assessOverdue(
    {
      status: row.status,
      obligations: [
        { kind: "dd_window_end", date: row.ddWindowEnd, status: row.ddWindowEnd ? "ok" : "not_applicable", verified },
        { kind: "report_due", date: row.reportDueDate, verified, stage: row.reportStage ?? null },
        { kind: "remit_due", date: row.remitDueDate, verified },
      ],
    },
    today,
  );
}

/** "123 days late", "1 day late". */
export function lateLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} late`;
}

/** Compact "Overdue 4mo" style label for tight cells. */
export function overdueShort(days: number): string {
  if (days < 31) return `Overdue ${days}d`;
  if (days < 365) return `Overdue ${Math.floor(days / 30)}mo`;
  return `Overdue ${Math.floor(days / 365)}y`;
}
