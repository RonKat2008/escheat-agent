import type { ClearRow, LedgerRow } from "./model";

export const LEDGER_COLUMNS = [
  "kind", "number", "payee_name", "payee_address", "payee_city", "payee_state", "payee_zip",
  "amount", "issue_date", "voided", "memo",
] as const;
export const CLEAR_COLUMNS = ["check_number", "amount", "cleared_date", "description"] as const;

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(columns: readonly string[], rows: readonly string[][]): string {
  return [columns.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

export function ledgerToCsv(rows: readonly LedgerRow[]): string {
  return toCsv(
    LEDGER_COLUMNS,
    rows.map((r) => [
      r.kind, r.number, r.payee_name, r.payee_address, r.payee_city, r.payee_state, r.payee_zip,
      dollars(r.amount_cents), r.issue_date, r.voided ? "true" : "false", r.memo,
    ]),
  );
}

export function clearsToCsv(rows: readonly ClearRow[]): string {
  return toCsv(
    CLEAR_COLUMNS,
    rows.map((r) => [r.check_number, dollars(r.amount_cents), r.cleared_date, r.description]),
  );
}
