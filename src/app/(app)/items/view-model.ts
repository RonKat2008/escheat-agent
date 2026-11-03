/**
 * Pure view-model for the Items page: saved views (§6.4: All · Needs action · Draft-ready · Due ≤ 90d) and the state
 * ribbon. No dates are computed here beyond the day distance to an engine-computed deadline.
 */
import { diffDays, type IsoDate } from "@/lib/dates";

export const SAVED_VIEWS = [
  { id: "all", label: "All" },
  { id: "needs-action", label: "Needs action" },
  { id: "draft-ready", label: "Draft-ready" },
  { id: "due-90", label: "Due ≤ 90d" },
] as const;

export type SavedViewId = (typeof SAVED_VIEWS)[number]["id"];
export const VIEW_IDS = SAVED_VIEWS.map((v) => v.id) as unknown as readonly [SavedViewId, ...SavedViewId[]];

export const DUE_SOON_DAYS = 90;

export interface ViewRow {
  id: string;
  ownerState: string | null;
  amount: { cents: number };
  nextDeadline: { date: string } | null;
}

export interface ViewSets {
  needsAction: ReadonlySet<string>;
  draftReady: ReadonlySet<string>;
}

/** Next engine deadline on or after asOf and within 90 days. Overdue items are the Overdue filter's job, not this view's. */
export function dueWithin(row: Pick<ViewRow, "nextDeadline">, asOf: string, days = DUE_SOON_DAYS): boolean {
  if (!row.nextDeadline) return false;
  const d = diffDays(asOf as IsoDate, row.nextDeadline.date as IsoDate);
  return d >= 0 && d <= days;
}

export function inView(row: ViewRow, view: SavedViewId, sets: ViewSets, asOf: string): boolean {
  switch (view) {
    case "needs-action":
      return sets.needsAction.has(row.id);
    case "draft-ready":
      return sets.draftReady.has(row.id);
    case "due-90":
      return dueWithin(row, asOf);
    default:
      return true;
  }
}

export function filterByView<T extends ViewRow>(rows: readonly T[], view: SavedViewId, sets: ViewSets, asOf: string): T[] {
  return rows.filter((r) => inView(r, view, sets, asOf));
}

export function viewCounts(rows: readonly ViewRow[], sets: ViewSets, asOf: string): Record<SavedViewId, number> {
  const out = { all: 0, "needs-action": 0, "draft-ready": 0, "due-90": 0 } as Record<SavedViewId, number>;
  for (const r of rows) for (const v of SAVED_VIEWS) if (inView(r, v.id, sets, asOf)) out[v.id] += 1;
  return out;
}

export interface RibbonSegment {
  /** Two-letter state, or null for items whose owner state is unknown. */
  state: string | null;
  cents: number;
  count: number;
  /** Share of the total amount, 0..1. Zero-amount states keep a sliver so they stay clickable. */
  share: number;
}

const MIN_SHARE = 0.04;

/** Stacked bar by owner state, largest first; Unknown last. Shares are normalised after the minimum sliver. */
export function stateRibbon(rows: readonly ViewRow[]): RibbonSegment[] {
  const by = new Map<string | null, { cents: number; count: number }>();
  for (const r of rows) {
    const cur = by.get(r.ownerState) ?? { cents: 0, count: 0 };
    by.set(r.ownerState, { cents: cur.cents + r.amount.cents, count: cur.count + 1 });
  }
  const total = [...by.values()].reduce((a, v) => a + v.cents, 0);
  const raw = [...by.entries()].map(([state, v]) => ({ state, ...v, share: Math.max(MIN_SHARE, total > 0 ? v.cents / total : 1 / by.size) }));
  const sum = raw.reduce((a, s) => a + s.share, 0);
  return raw
    .map((s) => ({ ...s, share: sum > 0 ? s.share / sum : 0 }))
    .sort((a, b) => (a.state === null ? 1 : b.state === null ? -1 : b.cents - a.cents || a.state.localeCompare(b.state)));
}
