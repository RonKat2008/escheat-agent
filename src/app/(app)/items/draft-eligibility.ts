import type { StaleItem } from "@/db/schema";

/**
 * Statuses the single-item draft route always refuses as "closed" (src/lib/outreach/bulk-plan.ts planOne: paid,
 * reported, remitted, or the due-diligence window has passed and the item is in the report queue). The drawer hides its
 * coral "Draft outreach" button for these instead of offering a click that can only be refused.
 */
const NEVER_DRAFTABLE: ReadonlySet<StaleItem["status"]> = new Set(["resolved_paid", "reported", "remitted", "to_report"]);

/** Whether the item drawer offers "Draft outreach" for an item in this status. */
export function drawerOffersDraft(status: StaleItem["status"]): boolean {
  return !NEVER_DRAFTABLE.has(status);
}
