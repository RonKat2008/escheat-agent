/**
 * Liability forecast: buckets the rules engine's dates into calendar months. Pure and deterministic; it never
 * computes a legal date itself (every date comes from `computeTimeline`) and never consults a model.
 *
 * Window: `horizonMonths` calendar months starting with the month that contains `asOf` (the simulated today).
 * The first bucket is partial (it starts at asOf; past dates in the current month are excluded). The window end
 * is exclusive: the first day of the month after the last bucket.
 *
 * Honesty rules:
 *  - A date the engine reports as `unknown` (a null rule value) is never placed in a month. The item goes into the
 *    UNKNOWN bucket with the missing kinds, the engine's notes and the rule paths involved.
 *  - `not_applicable` (e.g. amount below the due-diligence minimum) is not unknown: it simply produces no event.
 *  - Every event carries the engine's per-date `verified` flag; aggregates are unverified if any input is.
 */
import { addDays, addMonths, compare, fromYMD, toYMD, type IsoDate } from "@/lib/dates";
import { assertCents, type Cents } from "@/lib/money";
import type { DatedValue, Timeline } from "@/lib/rules/engine";

export const FORECAST_EVENT_KINDS = ["presumed_abandoned", "dd_window_opens", "report_due", "remit_due"] as const;
export type ForecastEventKind = (typeof FORECAST_EVENT_KINDS)[number];

export const FORECAST_EVENT_LABEL: Record<ForecastEventKind, string> = {
  presumed_abandoned: "Presumed abandoned",
  dd_window_opens: "Due diligence opens",
  report_due: "Report due",
  remit_due: "Remit due",
};

const KIND_ORDER: Record<ForecastEventKind, number> = { presumed_abandoned: 0, dd_window_opens: 1, report_due: 2, remit_due: 3 };

export const DEFAULT_HORIZON_MONTHS = 18;
export const MIN_HORIZON_MONTHS = 1;
export const MAX_HORIZON_MONTHS = 24;
export const HORIZON_OPTIONS = [6, 12, 18, 24] as const;

export interface ForecastItemInput {
  itemId: string;
  checkNumber: string | null;
  payeeName: string;
  /** Owner state (upper-case), or null when it could not be determined. */
  state: string | null;
  amountCents: Cents;
  /** Engine output for the item's owner state; null when no rule file applies. */
  timeline: Timeline | null;
  /** Why there is no timeline (shown in the UNKNOWN bucket). */
  noTimelineReason?: string;
}

export interface ForecastEvent {
  kind: ForecastEventKind;
  date: IsoDate;
  /** Report stage name for report_due events (CA has a notice and a report stage). */
  stage: string | null;
  itemId: string;
  checkNumber: string | null;
  payeeName: string;
  state: string;
  amountCents: Cents;
  verified: boolean;
}

export interface ForecastStateCell {
  state: string;
  presumedCount: number;
  presumedCents: Cents;
  ddOpenCount: number;
  ddOpenDates: IsoDate[];
  reportDue: { date: IsoDate; stage: string | null; count: number }[];
  remitDueDates: IsoDate[];
  remitCount: number;
  remitCents: Cents;
  /** Any value in this cell depends on an unverified rule. */
  unverified: boolean;
}

export interface ForecastMonth {
  /** YYYY-MM */
  month: string;
  /** First date in the window that belongs to this month (asOf for the first bucket). */
  from: IsoDate;
  /** Last date of the month (inclusive). */
  to: IsoDate;
  byState: ForecastStateCell[];
  presumedCents: Cents;
  presumedCount: number;
  remitCents: Cents;
  remitCount: number;
  counts: Record<ForecastEventKind, number>;
  anyUnverified: boolean;
  events: ForecastEvent[];
}

export interface ForecastUnknownItem {
  itemId: string;
  checkNumber: string | null;
  payeeName: string;
  state: string | null;
  amountCents: Cents;
  missing: ForecastEventKind[];
  reasons: string[];
  rulePaths: string[];
}

export interface Forecast {
  asOf: IsoDate;
  horizonMonths: number;
  windowStart: IsoDate;
  /** Exclusive. */
  windowEnd: IsoDate;
  /** States shown (the filter, or every state with an item), sorted. */
  states: string[];
  itemCount: number;
  months: ForecastMonth[];
  totals: {
    presumedCents: Cents;
    presumedCount: number;
    remitCents: Cents;
    remitCount: number;
    events: number;
    unverifiedEvents: number;
  };
  unknown: { count: number; cents: Cents; items: ForecastUnknownItem[] };
}

export interface ForecastOptions {
  asOf: IsoDate;
  horizonMonths?: number;
  /** Restrict to these owner states (case-insensitive). Empty or undefined = all. */
  states?: readonly string[];
}

/** Coerce an untrusted horizon (URL, tool input) into range; non-numbers fall back to the default. */
export function clampHorizon(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_HORIZON_MONTHS;
  return Math.min(MAX_HORIZON_MONTHS, Math.max(MIN_HORIZON_MONTHS, Math.trunc(n)));
}

/** First day of the month containing `date`. */
export function monthStart(date: IsoDate): IsoDate {
  const { y, m } = toYMD(date);
  return fromYMD(y, m, 1);
}

export interface MonthBucket {
  month: string;
  from: IsoDate;
  to: IsoDate;
}

/** The calendar-month buckets of the window, plus its exclusive end. */
export function monthBuckets(asOf: IsoDate, horizonMonths: number): { buckets: MonthBucket[]; end: IsoDate } {
  if (!Number.isInteger(horizonMonths) || horizonMonths < MIN_HORIZON_MONTHS || horizonMonths > MAX_HORIZON_MONTHS) {
    throw new RangeError(`horizonMonths must be an integer from ${MIN_HORIZON_MONTHS} to ${MAX_HORIZON_MONTHS}`);
  }
  const first = monthStart(asOf);
  const buckets: MonthBucket[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const start = addMonths(first, i);
    buckets.push({ month: start.slice(0, 7), from: i === 0 ? asOf : start, to: addDays(addMonths(first, i + 1), -1) });
  }
  return { buckets, end: addMonths(first, horizonMonths) };
}

interface Candidate {
  kind: ForecastEventKind;
  stage: string | null;
  value: DatedValue;
}

function candidates(tl: Timeline): Candidate[] {
  return [
    { kind: "presumed_abandoned", stage: null, value: tl.presumedAbandoned },
    { kind: "dd_window_opens", stage: null, value: tl.ddWindow.start },
    ...tl.reportStages.map((s): Candidate => ({ kind: "report_due", stage: s.name, value: s.due })),
    { kind: "remit_due", stage: null, value: tl.remitDue },
  ];
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

function unknownFor(item: ForecastItemInput): ForecastUnknownItem | null {
  const base = { itemId: item.itemId, checkNumber: item.checkNumber, payeeName: item.payeeName, state: item.state, amountCents: item.amountCents };
  if (!item.timeline) {
    return {
      ...base,
      missing: [...FORECAST_EVENT_KINDS],
      reasons: [item.noTimelineReason ?? (item.state ? `No rule file for ${item.state}` : "Owner state could not be determined")],
      rulePaths: [],
    };
  }
  const unknown = candidates(item.timeline).filter((c) => c.value.status === "unknown");
  if (unknown.length === 0) return null;
  return {
    ...base,
    missing: FORECAST_EVENT_KINDS.filter((k) => unknown.some((c) => c.kind === k)),
    reasons: uniq(unknown.flatMap((c) => c.value.notes)),
    rulePaths: uniq(unknown.flatMap((c) => c.value.ruleRefs.map((r) => `${r.state}@${r.version}:${r.path}`))),
  };
}

/** States alphabetically, items without an owner state last. */
const compareState = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b));

const compareEvents = (a: ForecastEvent, b: ForecastEvent) =>
  compare(a.date, b.date) ||
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  a.state.localeCompare(b.state) ||
  (a.stage ?? "").localeCompare(b.stage ?? "") ||
  (a.checkNumber ?? "").localeCompare(b.checkNumber ?? "") ||
  a.itemId.localeCompare(b.itemId);

function emptyCell(state: string): ForecastStateCell {
  return {
    state,
    presumedCount: 0,
    presumedCents: 0,
    ddOpenCount: 0,
    ddOpenDates: [],
    reportDue: [],
    remitDueDates: [],
    remitCount: 0,
    remitCents: 0,
    unverified: false,
  };
}

function addToCell(cell: ForecastStateCell, e: ForecastEvent): ForecastStateCell {
  const next = { ...cell, unverified: cell.unverified || !e.verified };
  switch (e.kind) {
    case "presumed_abandoned":
      return { ...next, presumedCount: cell.presumedCount + 1, presumedCents: cell.presumedCents + e.amountCents };
    case "dd_window_opens":
      return { ...next, ddOpenCount: cell.ddOpenCount + 1, ddOpenDates: uniq([...cell.ddOpenDates, e.date]) };
    case "report_due": {
      const hit = cell.reportDue.find((r) => r.date === e.date && r.stage === e.stage);
      const reportDue = hit
        ? cell.reportDue.map((r) => (r === hit ? { ...r, count: r.count + 1 } : r))
        : [...cell.reportDue, { date: e.date, stage: e.stage, count: 1 }];
      return { ...next, reportDue };
    }
    case "remit_due":
      return {
        ...next,
        remitCount: cell.remitCount + 1,
        remitCents: cell.remitCents + e.amountCents,
        remitDueDates: uniq([...cell.remitDueDates, e.date]),
      };
  }
}

function buildMonth(bucket: MonthBucket, events: ForecastEvent[]): ForecastMonth {
  const cells = new Map<string, ForecastStateCell>();
  for (const e of events) cells.set(e.state, addToCell(cells.get(e.state) ?? emptyCell(e.state), e));
  const byState = [...cells.values()].sort((a, b) => a.state.localeCompare(b.state));
  const counts = Object.fromEntries(FORECAST_EVENT_KINDS.map((k) => [k, events.filter((e) => e.kind === k).length])) as Record<ForecastEventKind, number>;
  return {
    ...bucket,
    byState,
    presumedCents: byState.reduce((a, c) => a + c.presumedCents, 0),
    presumedCount: counts.presumed_abandoned,
    remitCents: byState.reduce((a, c) => a + c.remitCents, 0),
    remitCount: counts.remit_due,
    counts,
    anyUnverified: events.some((e) => !e.verified),
    events,
  };
}

/** Build the forecast from engine timelines. Deterministic: same inputs, same output (including order). */
export function buildForecast(items: readonly ForecastItemInput[], opts: ForecastOptions): Forecast {
  const horizonMonths = opts.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const { buckets, end } = monthBuckets(opts.asOf, horizonMonths);
  const filter = new Set((opts.states ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean));
  const scoped = items.filter((i) => filter.size === 0 || (i.state !== null && filter.has(i.state.toUpperCase())));

  const events: ForecastEvent[] = [];
  const unknownItems: ForecastUnknownItem[] = [];
  for (const item of scoped) {
    assertCents(item.amountCents);
    const unknown = unknownFor(item);
    if (unknown) unknownItems.push(unknown);
    if (!item.timeline || !item.state) continue;
    for (const c of candidates(item.timeline)) {
      const date = c.value.date;
      if (c.value.status !== "ok" || date === null) continue;
      if (compare(date, opts.asOf) < 0 || compare(date, end) >= 0) continue;
      events.push({
        kind: c.kind,
        date,
        stage: c.stage,
        itemId: item.itemId,
        checkNumber: item.checkNumber,
        payeeName: item.payeeName,
        state: item.state.toUpperCase(),
        amountCents: item.amountCents,
        verified: c.value.verified,
      });
    }
  }
  events.sort(compareEvents);

  const months = buckets.map((b) => buildMonth(b, events.filter((e) => e.date.startsWith(b.month))));
  unknownItems.sort((a, b) => compareState(a.state, b.state) || b.amountCents - a.amountCents || a.itemId.localeCompare(b.itemId));
  const states = filter.size > 0 ? [...filter].sort() : uniq(scoped.map((i) => i.state?.toUpperCase()).filter((s): s is string => Boolean(s))).sort();

  return {
    asOf: opts.asOf,
    horizonMonths,
    windowStart: opts.asOf,
    windowEnd: end,
    states,
    itemCount: scoped.length,
    months,
    totals: {
      presumedCents: months.reduce((a, m) => a + m.presumedCents, 0),
      presumedCount: months.reduce((a, m) => a + m.presumedCount, 0),
      remitCents: months.reduce((a, m) => a + m.remitCents, 0),
      remitCount: months.reduce((a, m) => a + m.remitCount, 0),
      events: events.length,
      unverifiedEvents: events.filter((e) => !e.verified).length,
    },
    unknown: { count: unknownItems.length, cents: unknownItems.reduce((a, u) => a + u.amountCents, 0), items: unknownItems },
  };
}

export interface CalendarDeadline {
  kind: Exclude<ForecastEventKind, "presumed_abandoned">;
  date: IsoDate;
  state: string;
  stage: string | null;
  count: number;
  cents: Cents;
  verified: boolean;
}

/**
 * Filing deadlines (DD window openings, report and remit due dates) aggregated per date/kind/state/stage, for the
 * calendar feed. Presumed-abandoned dates are not deadlines and are left out.
 */
export function calendarDeadlines(forecast: Forecast): CalendarDeadline[] {
  const map = new Map<string, CalendarDeadline>();
  for (const m of forecast.months) {
    for (const e of m.events) {
      if (e.kind === "presumed_abandoned") continue;
      const key = `${e.date}|${e.kind}|${e.state}|${e.stage ?? ""}`;
      const prev = map.get(key);
      map.set(
        key,
        prev
          ? { ...prev, count: prev.count + 1, cents: prev.cents + e.amountCents, verified: prev.verified && e.verified }
          : { kind: e.kind, date: e.date, state: e.state, stage: e.stage, count: 1, cents: e.amountCents, verified: e.verified },
      );
    }
  }
  return [...map.values()];
}
