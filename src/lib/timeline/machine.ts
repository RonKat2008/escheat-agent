/**
 * Pure per-item timeline state machine. No I/O, no clock reads: callers pass `now` (from clock.ts).
 *
 * Statuses are the `stale_status` DB enum values. Mapping to the product vocabulary:
 *   detected          = watching
 *   outreach_pending  = dd_pending   (inside the DD window: letter/email/call task should exist)
 *   outreach_sent     = dd_sent
 *   owner_responded   = owner_responded
 *   resolved          = resolved_paid
 *   to_report / reported / remitted / recovered = same
 *   unknown_rule      = a rule is missing; the item is re-evaluated as `detected` once dates exist
 *
 * Transitions (earliest applicable wins; the machine runs to a fixed point, so a late item can cross
 * several states in one call):
 *   detected -> outreach_pending      now >= ddWindowStart                     [create_outreach_task]
 *   detected|outreach_*|owner_responded -> to_report
 *                                     now >= ddWindowEnd (unresolved) or now >= reportDue [flag_for_report]
 *   outreach_pending -> outreach_sent event outreach_sent
 *   outreach_pending|outreach_sent -> owner_responded   event owner_responded
 *   (any pre-reported) -> resolved    event paid                               (owner paid / already cashed)
 *   to_report -> reported             event report_submitted
 *   reported -> remitted              event remitted
 * Unknown (null) dates never get invented: the item stays put and the result carries `needs_rule`.
 */

import { addDays, compare, type IsoDate } from "../dates";
import type { StaleStatus } from "@/db/schema";

export type MachineStatus = StaleStatus;

export type OwnerResponse = "confirm_address" | "already_cashed" | "send_money" | "other";

export type MachineEvent =
  | { type: "outreach_sent"; at?: IsoDate }
  | { type: "owner_responded"; response: OwnerResponse; at?: IsoDate }
  | { type: "paid"; at?: IsoDate }
  | { type: "report_submitted"; at?: IsoDate }
  | { type: "remitted"; at?: IsoDate };

export interface MachineItem {
  status: MachineStatus;
  ddWindowStart: IsoDate | null;
  ddWindowEnd: IsoDate | null;
  reportDueDate: IsoDate | null;
  remitDueDate: IsoDate | null;
  /** false = no due diligence for this item (skip straight to the report date). Default true. */
  ddApplies?: boolean | null;
}

export type MachineAction =
  | { type: "create_outreach_task" }
  | { type: "flag_for_report"; reason: "dd_window_closed" | "report_due" | "dd_not_required" }
  | { type: "dd_window_missed" }
  | { type: "await_payment" }
  | { type: "verify_cashed" }
  | { type: "report_overdue" }
  | { type: "remit_overdue" }
  | { type: "needs_rule"; missing: string[] };

export interface TransitionResult {
  status: MachineStatus;
  /** Next date at which re-running the machine could change the outcome; null if none (terminal/unknown). */
  nextWakeAt: IsoDate | null;
  actions: MachineAction[];
  changed: boolean;
}

const TERMINAL: ReadonlySet<MachineStatus> = new Set(["resolved", "remitted", "recovered"]);
const PRE_REPORTED: ReadonlySet<MachineStatus> = new Set([
  "detected",
  "unknown_rule",
  "outreach_pending",
  "outreach_sent",
  "owner_responded",
  "to_report",
]);

const has = (events: readonly MachineEvent[], type: MachineEvent["type"]) => events.some((e) => e.type === type);
const lastResponse = (events: readonly MachineEvent[]): OwnerResponse | null => {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "owner_responded") return e.response;
  }
  return null;
};

const reached = (now: IsoDate, d: IsoDate | null) => d !== null && compare(now, d) >= 0;

interface Step {
  status: MachineStatus;
  actions: MachineAction[];
}

function step(item: MachineItem, status: MachineStatus, now: IsoDate, events: readonly MachineEvent[]): Step | null {
  if (TERMINAL.has(status)) return null;
  if (PRE_REPORTED.has(status) && has(events, "paid")) return { status: "resolved", actions: [] };

  const ddApplies = item.ddApplies !== false;
  switch (status) {
    case "detected": {
      if (!ddApplies) {
        return reached(now, item.reportDueDate)
          ? { status: "to_report", actions: [{ type: "flag_for_report", reason: "dd_not_required" }] }
          : null;
      }
      if (reached(now, item.ddWindowEnd) || reached(now, item.reportDueDate)) {
        return {
          status: "to_report",
          actions: [
            { type: "dd_window_missed" },
            { type: "flag_for_report", reason: reached(now, item.ddWindowEnd) ? "dd_window_closed" : "report_due" },
          ],
        };
      }
      if (reached(now, item.ddWindowStart)) {
        return { status: "outreach_pending", actions: [{ type: "create_outreach_task" }] };
      }
      return null;
    }
    case "outreach_pending":
    case "outreach_sent":
    case "owner_responded": {
      if (status === "outreach_pending" && has(events, "outreach_sent") && !has(events, "owner_responded")) {
        return { status: "outreach_sent", actions: [] };
      }
      if ((status === "outreach_pending" || status === "outreach_sent") && has(events, "owner_responded")) {
        return { status: "owner_responded", actions: [] };
      }
      if (reached(now, item.ddWindowEnd) || reached(now, item.reportDueDate)) {
        const actions: MachineAction[] = [];
        if (status === "outreach_pending") actions.push({ type: "dd_window_missed" });
        actions.push({ type: "flag_for_report", reason: reached(now, item.ddWindowEnd) ? "dd_window_closed" : "report_due" });
        return { status: "to_report", actions };
      }
      return null;
    }
    case "to_report":
      return has(events, "report_submitted") ? { status: "reported", actions: [] } : null;
    case "reported":
      return has(events, "remitted") ? { status: "remitted", actions: [] } : null;
    default:
      return null;
  }
}

/** Earliest known date strictly in the future, as the next time the item needs another look. */
function earliestFuture(now: IsoDate, dates: Array<IsoDate | null>): IsoDate | null {
  const future = dates.filter((d): d is IsoDate => d !== null && compare(d, now) > 0).sort();
  return future[0] ?? null;
}

function hold(item: MachineItem, status: MachineStatus, now: IsoDate, events: readonly MachineEvent[]): {
  actions: MachineAction[];
  wake: IsoDate | null;
} {
  const actions: MachineAction[] = [];
  const ddApplies = item.ddApplies !== false;
  const missing: string[] = [];
  switch (status) {
    case "detected": {
      if (ddApplies) {
        if (item.ddWindowStart === null) missing.push("ddWindowStart");
        if (item.ddWindowEnd === null && item.reportDueDate === null) missing.push("ddWindowEnd", "reportDueDate");
      } else if (item.reportDueDate === null) missing.push("reportDueDate");
      if (missing.length) actions.push({ type: "needs_rule", missing });
      return {
        actions,
        wake: earliestFuture(now, ddApplies ? [item.ddWindowStart, item.ddWindowEnd, item.reportDueDate] : [item.reportDueDate]),
      };
    }
    case "outreach_pending":
    case "outreach_sent":
    case "owner_responded": {
      if (item.ddWindowEnd === null && item.reportDueDate === null) {
        actions.push({ type: "needs_rule", missing: ["ddWindowEnd", "reportDueDate"] });
      }
      if (status === "owner_responded") {
        const resp = lastResponse(events);
        if (resp === "send_money") actions.push({ type: "await_payment" });
        else if (resp === "already_cashed") actions.push({ type: "verify_cashed" });
      }
      return { actions, wake: earliestFuture(now, [item.ddWindowEnd, item.reportDueDate]) };
    }
    case "to_report": {
      if (item.reportDueDate === null) {
        actions.push({ type: "needs_rule", missing: ["reportDueDate"] });
        return { actions, wake: null };
      }
      if (compare(now, item.reportDueDate) > 0) {
        actions.push({ type: "report_overdue" });
        return { actions, wake: null };
      }
      return { actions, wake: addDays(item.reportDueDate, 1) };
    }
    case "reported": {
      if (item.remitDueDate === null) {
        actions.push({ type: "needs_rule", missing: ["remitDueDate"] });
        return { actions, wake: null };
      }
      if (compare(now, item.remitDueDate) > 0) {
        actions.push({ type: "remit_overdue" });
        return { actions, wake: null };
      }
      return { actions, wake: addDays(item.remitDueDate, 1) };
    }
    default:
      return { actions, wake: null };
  }
}

/**
 * Advance an item as far as `events` and `now` allow. `events` is the item's full event history.
 * Idempotent: feeding the returned status back in with the same inputs returns the same status and no
 * transition actions.
 */
export function nextTransition(item: MachineItem, now: IsoDate, events: readonly MachineEvent[] = []): TransitionResult {
  const start = item.status;
  let status: MachineStatus = start === "unknown_rule" ? "detected" : start;
  const actions: MachineAction[] = [];
  for (let i = 0; i < 12; i++) {
    const s = step(item, status, now, events);
    if (!s) break;
    status = s.status;
    actions.push(...s.actions);
  }
  const h = hold(item, status, now, events);
  actions.push(...h.actions);
  // An item that was flagged unknown_rule and is still stuck stays unknown_rule.
  const finalStatus: MachineStatus = start === "unknown_rule" && status === "detected" ? "unknown_rule" : status;
  return { status: finalStatus, nextWakeAt: h.wake, actions, changed: finalStatus !== start };
}
