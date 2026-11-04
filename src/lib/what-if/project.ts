/**
 * What-if projection (pure, deterministic, no I/O, no clock reads, no writes).
 *
 * Every date comes from the rules engine's persisted output (stale_items). The simulator only decides, per scenario,
 * whether each obligation is PERFORMED on its date or MISSED, then asks the app's single overdue authority
 * (src/lib/overdue.ts) what is late at the simulated date. Unknown dates stay unknown: an item whose report date is
 * unknown is never "filed", and never counted as missed (it is reported as unknown instead).
 *
 * Handling per item:
 *  - "paid": the owner responds and is paid. The item leaves exposure, owes nothing and accrues no interest.
 *  - "on_time": its state is set to file and remit on the due dates, or the item is remitted with the next report.
 *    Due diligence goes out when the window opens, the report is filed on its due date and the money is remitted on
 *    the remit date. An obligation already late today is performed today (a catch-up); it cannot be made on time.
 *  - "miss": nothing happens. Obligations pass and become missed.
 */
import { compare, maxDate, type IsoDate, addDays } from "@/lib/dates";
import { assessPersisted, obligationPending, type ItemStatus, type ObligationKind } from "@/lib/overdue";
import { projectInterest } from "./interest";
import { handlingOf, normalizeScenario, stateOf } from "./scenario";
import {
  MAX_OFFSET,
  type EventKind,
  type Handling,
  type Projection,
  type Scenario,
  type StateExposure,
  type TimelineEvent,
  type WhatIfItem,
  type WhatIfSnapshot,
} from "./types";

const DONE: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["resolved_paid", "remitted"]);
/** Exposure excludes filed items, exactly like the dashboard (src/lib/queries/exposure.ts). */
const NOT_EXPOSED: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["resolved_paid", "remitted", "reported"]);
const DD_OWED: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["watching", "dd_pending", "needs_rule"]);

/** When each step is performed under on-time handling (a date already past is performed today). Null = never/unknown. */
export interface ActionDates {
  ddSent: IsoDate | null;
  reportFiled: IsoDate | null;
  remitted: IsoDate | null;
}

export function onTimeActions(item: WhatIfItem, today: IsoDate): ActionDates {
  const on = (d: string | null): IsoDate | null => (d ? maxDate(d as IsoDate, today) : null);
  const alreadyReported = item.status === "reported";
  const reportFiled = alreadyReported ? today : on(item.reportDueDate);
  return {
    ddSent: DD_OWED.has(item.status) && item.ddWindowEnd ? on(item.ddWindowStart ?? today) : null,
    reportFiled,
    // Money moves only once the report is known: an unknown report date means the filing cannot be simulated.
    remitted: reportFiled ? on(item.remitDueDate) : null,
  };
}

const reached = (d: IsoDate | null, at: IsoDate) => d !== null && compare(d, at) <= 0;

/** The item's status at `at` under its handling. */
export function statusAt(item: WhatIfItem, handling: Handling, today: IsoDate, at: IsoDate): ItemStatus {
  if (handling === "paid") return "resolved_paid";
  if (handling === "miss" || DONE.has(item.status)) return item.status;
  const a = onTimeActions(item, today);
  if (reached(a.reportFiled, at) && reached(a.remitted, at)) return "remitted";
  if (reached(a.reportFiled, at)) return "reported";
  if (reached(a.ddSent, at)) return "dd_sent";
  return item.status;
}

const OBLIGATIONS: readonly ObligationKind[] = ["dd_window_end", "report_due", "remit_due"];
const DATE_OF: Record<EventKind, (i: WhatIfItem) => string | null> = {
  presumed_abandoned: (i) => i.presumedAbandonedDate,
  dd_window_start: (i) => i.ddWindowStart,
  dd_window_end: (i) => i.ddWindowEnd,
  report_due: (i) => i.reportDueDate,
  remit_due: (i) => i.remitDueDate,
};
export const EVENT_KINDS: readonly EventKind[] = ["presumed_abandoned", "dd_window_start", "dd_window_end", "report_due", "remit_due"];

function obligationOutcome(item: WhatIfItem, kind: ObligationKind, handling: Handling, date: IsoDate, today: IsoDate): TimelineEvent["outcome"] {
  if (handling === "paid") return "moot";
  if (handling === "miss") return "missed";
  const a = onTimeActions(item, today);
  const done = kind === "dd_window_end" ? a.ddSent : kind === "report_due" ? a.reportFiled : a.remitted;
  return done !== null && compare(done, date) <= 0 ? "met" : "missed";
}

/**
 * Every dated crossing up to today + MAX_OFFSET for the timeline. Obligations already met before today (a filed
 * report, a sent letter) are not drawn. Undated (unknown) obligations have no place on a timeline and are counted
 * in `deadlines.unknown` instead.
 */
export function timelineEvents(snap: WhatIfSnapshot, s: Scenario): TimelineEvent[] {
  const today = snap.today as IsoDate;
  const end = addDays(today, MAX_OFFSET);
  const out: TimelineEvent[] = [];
  for (const item of snap.items) {
    const handling = handlingOf(item, s);
    for (const kind of EVENT_KINDS) {
      const date = DATE_OF[kind](item) as IsoDate | null;
      if (!date || compare(date, end) > 0) continue;
      const isObligation = (OBLIGATIONS as readonly string[]).includes(kind);
      if (isObligation && !obligationPending(kind as ObligationKind, item.status)) continue;
      // Past crossings (presumed abandoned last year, a window that already opened) are history, not events.
      if (!isObligation && compare(date, today) <= 0) continue;
      out.push({
        key: `${item.id}:${kind}`,
        itemId: item.id,
        kind,
        date,
        state: stateOf(item),
        amountCents: item.amountCents,
        unverified: item.unverified,
        outcome: isObligation ? obligationOutcome(item, kind as ObligationKind, handling, date, today) : handling === "paid" ? "moot" : "crossing",
      });
    }
  }
  return out.sort((a, b) => compare(a.date as IsoDate, b.date as IsoDate) || a.key.localeCompare(b.key));
}

function exposureAt(snap: WhatIfSnapshot, s: Scenario, at: IsoDate): Projection["exposure"] {
  const today = snap.today as IsoDate;
  const by = new Map<string, StateExposure>();
  for (const item of snap.items) {
    const status = statusAt(item, handlingOf(item, s), today, at);
    if (NOT_EXPOSED.has(status)) continue;
    const k = stateOf(item);
    const cur = by.get(k) ?? { state: k, cents: 0, count: 0, anyUnverified: false };
    by.set(k, {
      ...cur,
      cents: cur.cents + item.amountCents,
      count: cur.count + 1,
      anyUnverified: cur.anyUnverified || item.unverified || item.status === "needs_rule",
    });
  }
  const byState = [...by.values()].sort((a, b) => b.cents - a.cents || a.state.localeCompare(b.state));
  return { cents: byState.reduce((a, x) => a + x.cents, 0), count: byState.reduce((a, x) => a + x.count, 0), byState };
}

function deadlinesAt(snap: WhatIfSnapshot, s: Scenario, at: IsoDate): Projection["deadlines"] {
  const today = snap.today as IsoDate;
  let missed = 0;
  let missedItems = 0;
  let unknown = 0;
  let anyUnverified = false;
  for (const item of snap.items) {
    const a = assessPersisted(
      {
        status: statusAt(item, handlingOf(item, s), today, at),
        ddWindowEnd: item.ddWindowEnd,
        reportDueDate: item.reportDueDate,
        remitDueDate: item.remitDueDate,
        dependsOnUnverified: item.unverified,
      },
      at,
    );
    missed += a.overdue.length;
    missedItems += a.overdue.length > 0 ? 1 : 0;
    unknown += a.unknown.length;
    anyUnverified ||= a.overdue.length > 0 && !a.verified;
  }
  return { missed, missedItems, unknown, anyUnverified };
}

function crossingsAt(snap: WhatIfSnapshot, s: Scenario, at: IsoDate): Projection["crossings"] {
  const today = snap.today as IsoDate;
  const counts = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])) as Record<EventKind, number>;
  for (const e of timelineEvents(snap, s)) {
    if (e.outcome === "moot") continue;
    if (compare(e.date as IsoDate, today) > 0 && compare(e.date as IsoDate, at) <= 0) counts[e.kind] += 1;
  }
  return counts;
}

/** The whole projection at today + scenario.offset. */
export function project(snap: WhatIfSnapshot, scenario: Scenario): Projection {
  const s = normalizeScenario(scenario, snap);
  const today = snap.today as IsoDate;
  const at = addDays(today, s.offset);
  return {
    asOf: at,
    offset: s.offset,
    exposure: exposureAt(snap, s, at),
    interest: projectInterest(snap, s, at),
    deadlines: deadlinesAt(snap, s, at),
    crossings: crossingsAt(snap, s, at),
  };
}

export interface ProjectionDelta {
  exposureCents: number;
  /** Null when either side's interest total is UNKNOWN. */
  interestCents: number | null;
  /** Difference of the labelled known-states subtotals (always available). */
  knownInterestCents: number;
  missed: number;
}

export function delta(base: Projection, next: Projection): ProjectionDelta {
  return {
    exposureCents: next.exposure.cents - base.exposure.cents,
    interestCents: base.interest.cents === null || next.interest.cents === null ? null : next.interest.cents - base.interest.cents,
    knownInterestCents: next.interest.knownCents - base.interest.knownCents,
    missed: next.deadlines.missed - base.deadlines.missed,
  };
}
