/**
 * Where late-money interest starts, per item, read from the sourced interest rule (never from memory).
 *
 * Every state's interest provision says from which date interest runs. CA (CCP § 1577): "from the date the property
 * should have been reported, paid, or delivered"; TX: "from the date the property should have been paid/delivered".
 * So a reported-but-unremitted item (its report is filed, its payment is late) accrues from its remit due date, but
 * ONLY when the rule's own basis text says payment/delivery starts the clock. When it does not (or the rule is null),
 * the answer is "unsupported" and callers show UNKNOWN, never a guessed number.
 */
import type { IsoDate } from "@/lib/dates";
import type { RuleFile } from "../../../rules/schema";

/** True when the rule's basis text says that a missed payment/delivery date (not only a missed report) starts interest. */
export function basisCoversPayment(rules: RuleFile): boolean {
  const basis = rules.interest.value?.basis;
  return typeof basis === "string" && /\b(paid|payment|pay|deliver(ed|y)?|remit(ted|tance)?)\b/i.test(basis);
}

export interface AccrualDates {
  /** Date the report was due, when that obligation is still missed/outstanding. */
  reportDue: IsoDate | null | undefined;
  /** Date the remittance was due, when that obligation is still missed/outstanding. */
  remitDue: IsoDate | null | undefined;
}

/**
 * The date interest starts for one item: the earliest outstanding obligation the rule says starts it.
 * Returns `null` when the item has no applicable date, and "unsupported" when only a remit date exists and the rule
 * does not say payment starts interest.
 */
export function accrualStart(d: AccrualDates, rules: RuleFile): IsoDate | null | "unsupported" {
  const covers = basisCoversPayment(rules);
  const candidates: IsoDate[] = [];
  if (d.reportDue) candidates.push(d.reportDue);
  if (d.remitDue && covers) candidates.push(d.remitDue);
  if (candidates.length > 0) return [...candidates].sort()[0]!;
  return d.remitDue && !covers ? "unsupported" : null;
}
