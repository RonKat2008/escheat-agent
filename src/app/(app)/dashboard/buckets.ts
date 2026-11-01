import type { Exposure } from "@/lib/queries";

export interface HeroBucket {
  id: "reportable" | "letters_due" | "awaiting_owner" | "watching" | "needs_rule";
  label: string;
  /** What the number means, shown as a tooltip and read by screen readers. */
  hint: string;
  /** The Items status filter the bucket links to. */
  status: string;
  count: number;
  cents: number;
}

const DEFS: { id: HeroBucket["id"]; label: string; hint: string; statuses: string[] }[] = [
  { id: "reportable", label: "Reportable now", hint: "Past the due-diligence window; goes on the next state report", statuses: ["to_report"] },
  { id: "letters_due", label: "Letters due", hint: "The due-diligence letter is due now", statuses: ["dd_pending"] },
  { id: "awaiting_owner", label: "Awaiting owner", hint: "Letter mailed or owner replied; waiting on payment", statuses: ["dd_sent", "owner_responded"] },
  { id: "watching", label: "Watching", hint: "Outstanding but not yet in a due-diligence window", statuses: ["watching"] },
  { id: "needs_rule", label: "Needs a rule", hint: "A rule value is missing, so the dates are unknown", statuses: ["needs_rule"] },
];

/** Splits the unfiled exposure by what the reader has to do about it. Empty buckets are dropped. */
export function heroBuckets(byStatus: Exposure["byStatus"]): HeroBucket[] {
  return DEFS.flatMap((d) => {
    const rows = byStatus.filter((r) => d.statuses.includes(r.status));
    const count = rows.reduce((a, r) => a + r.count, 0);
    if (count === 0) return [];
    return [{ id: d.id, label: d.label, hint: d.hint, status: d.statuses[0]!, count, cents: rows.reduce((a, r) => a + r.cents, 0) }];
  });
}
