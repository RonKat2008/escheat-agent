import { formatUSD } from "@/lib/money";

/** What the clock API reports for a move: the items it newly detected as stale. */
export interface ClockDetected {
  count: number;
  cents: number;
}

export interface DetectedToast {
  message: string;
  /** Where the toast's link goes. */
  href: string;
  linkLabel: string;
}

/**
 * The line shown after the demo clock moves. Null when nothing new was detected (the move toast already says the
 * date; a second "nothing happened" toast is noise). Counts and money are the API's own values, never recomputed.
 */
export function detectedToast(d: ClockDetected | null | undefined): DetectedToast | null {
  if (!d || !Number.isFinite(d.count) || d.count <= 0) return null;
  const items = d.count === 1 ? "1 new stale item" : `${d.count.toLocaleString("en-US")} new stale items`;
  return { message: `${items} detected · ${formatUSD(d.cents)}`, href: "/items", linkLabel: "Open items" };
}
