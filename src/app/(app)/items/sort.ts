import type { StaleSort } from "@/lib/queries/schemas";

export const DEFAULT_SORT: StaleSort = "age_desc";

type Dir = "asc" | "desc";

/**
 * Table column id -> the server sort value for each direction of that column, and which direction a first click picks.
 * "Issued" shows how long ago a check was issued, so its ascending order (youngest first) is the server's age_asc and
 * the default age_desc (oldest first) is that column descending.
 */
const COLUMN_SORTS: Readonly<Record<string, { asc: StaleSort; desc: StaleSort; first: Dir }>> = {
  payee: { asc: "payee_asc", desc: "payee_desc", first: "asc" },
  amount: { asc: "amount_asc", desc: "amount_desc", first: "desc" },
  age: { asc: "age_asc", desc: "age_desc", first: "asc" },
  deadline: { asc: "deadline_asc", desc: "deadline_desc", first: "asc" },
};

export function isSortableColumn(columnId: string): boolean {
  return columnId in COLUMN_SORTS;
}

export interface ActiveSort {
  columnId: string;
  dir: Dir;
}

/** Which column and direction a URL sort value means, for the header arrow and aria-sort. */
export function activeSort(sort: StaleSort | null): ActiveSort | null {
  const value = sort ?? DEFAULT_SORT;
  for (const [columnId, s] of Object.entries(COLUMN_SORTS)) {
    if (value === s.asc) return { columnId, dir: "asc" };
    if (value === s.desc) return { columnId, dir: "desc" };
  }
  return null;
}

/** The sort to put in the URL when a column header is clicked: its first direction, then the opposite one. */
export function nextSort(columnId: string, current: StaleSort | null): StaleSort | null {
  const s = COLUMN_SORTS[columnId];
  if (!s) return current;
  const active = activeSort(current);
  const dir: Dir = active?.columnId === columnId ? (active.dir === "asc" ? "desc" : "asc") : s.first;
  return s[dir];
}
