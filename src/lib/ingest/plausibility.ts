import type { RowIssue } from "./csv";
import type { ClearRow, LedgerRow } from "./schemas";

/** Messages are constant per kind of problem so identical issues group together. */
const futureMessage = (label: string, today: string) =>
  `${label} is after today (${today}); future-dated items are not accepted`;
const NEGATIVE = "amount is negative; amounts must be positive";

/** Implausible-value checks for ledger rows. `today` is the simulated clock date (YYYY-MM-DD). */
export function ledgerPlausibility(today: string): (row: LedgerRow) => RowIssue[] {
  return (row) => {
    const issues: RowIssue[] = [];
    if (row.issueDate > today) issues.push({ field: "issueDate", message: futureMessage("issue date", today) });
    if (row.amount < 0) issues.push({ field: "amount", message: NEGATIVE });
    return issues;
  };
}

/** Bank exports may show debits as negatives, so only the date is checked. */
export function clearPlausibility(today: string): (row: ClearRow) => RowIssue[] {
  return (row) =>
    row.clearedDate > today ? [{ field: "clearedDate", message: futureMessage("cleared date", today) }] : [];
}
