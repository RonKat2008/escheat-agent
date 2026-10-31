/** Pure sorting and filtering for the chat items table (unit-tested; no React). */
import type { StaleItemRow } from "@/lib/queries/schemas";

export type SortKey = "payee" | "amount" | "age" | "deadline";
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

const compare: Record<SortKey, (a: StaleItemRow, b: StaleItemRow) => number> = {
  payee: (a, b) => a.payeeName.localeCompare(b.payeeName),
  amount: (a, b) => a.amount.cents - b.amount.cents,
  age: (a, b) => a.ageDays - b.ageDays,
  // Items without a deadline sort last in either direction.
  deadline: (a, b) => (a.nextDeadline?.date ?? "9999-12-31").localeCompare(b.nextDeadline?.date ?? "9999-12-31"),
};

/** Stable sort that never mutates its input; ties keep the tool's original order. */
export function sortItems(items: readonly StaleItemRow[], sort: SortState): StaleItemRow[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => compare[sort.key](a.item, b.item) * sort.dir || a.i - b.i)
    .map((x) => x.item);
}

/** Clicking the active column flips it; a new column starts in its natural direction (text/dates ascending, numbers descending). */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 };
  return { key, dir: key === "payee" || key === "deadline" ? 1 : -1 };
}

export interface ItemFilter {
  query: string;
  status: string | null;
}

/** Case-insensitive match on payee name or check number ("#10482" and "10482" both match); optional exact status. */
export function filterItems(items: readonly StaleItemRow[], f: ItemFilter): StaleItemRow[] {
  const q = f.query.trim().toLowerCase().replace(/^#/, "");
  return items.filter((i) => {
    if (f.status && i.status !== f.status) return false;
    if (!q) return true;
    return i.payeeName.toLowerCase().includes(q) || (i.checkNumber ?? "").toLowerCase().includes(q);
  });
}

/** Status values present in the rows, most common first, with counts (for the filter chips). */
export function statusCounts(items: readonly StaleItemRow[]): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}
