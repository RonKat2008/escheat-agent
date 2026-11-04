/** Reissue worklist CSV (read-only export). Dates come from the rules engine on a PROVISIONAL classification. */
import { toCsv } from "@/lib/csv";
import { centsToDollars } from "@/lib/money";
import type { HorizonItem } from "./project";

export const HORIZON_CSV_HEADER = [
  "check_number",
  "payee",
  "property_type",
  "amount_usd",
  "issue_date",
  "age_days",
  "days_until_stale",
  "stale_on",
  "owner_state_provisional",
  "presumed_abandoned_projected",
  "report_due_projected",
  "remit_due_projected",
  "dates_status",
  "rule_version",
  "suggested_action",
] as const;

export const SUGGESTED_ACTION = "Contact payee; confirm details; cash or reissue (e.g. by ACH) before it goes stale";

function datesStatus(i: HorizonItem): string {
  if (!i.dates) return `UNKNOWN: ${i.unknownReason ?? "no rule"}`;
  return i.dates.unverified ? "PROVISIONAL, UNVERIFIED" : "PROVISIONAL";
}

export function horizonCsvRow(i: HorizonItem): unknown[] {
  return [
    i.checkNumber,
    i.payeeName,
    i.propertyType,
    centsToDollars(i.amountCents).toFixed(2),
    i.issueDate,
    i.ageDays,
    i.daysUntilStale,
    i.staleOn,
    i.ownerState ?? "UNKNOWN",
    i.dates?.presumedAbandoned ?? "UNKNOWN",
    i.dates?.reportDue ?? "UNKNOWN",
    i.dates?.remitDue ?? "UNKNOWN",
    datesStatus(i),
    i.dates?.ruleVersion ?? "",
    SUGGESTED_ACTION,
  ];
}

export function horizonCsv(items: readonly HorizonItem[]): string {
  return toCsv(HORIZON_CSV_HEADER, items.map(horizonCsvRow));
}
