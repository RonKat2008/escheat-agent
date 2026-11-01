/**
 * Totals reconciliation for a state report. An open report is compared with the live "to report" pool (so edits
 * after generation are caught); a submitted/confirmed report is LOCKED and is compared only with its own snapshot
 * (the report row vs. the NAUPA file it was filed from), because filing legitimately empties the pool.
 */
export const LOCKED_REPORT_STATUSES: readonly string[] = ["submitted", "confirmed"];

export const isReportLocked = (status: string | null | undefined): boolean => !!status && LOCKED_REPORT_STATUSES.includes(status);

export interface ReconRow {
  label: string;
  count: number | null;
  cents: number | null;
  note?: "record";
}

export interface ReconInput {
  status: string;
  pool: { count: number; cents: number };
  report: { count: number; cents: number };
  file: { count: number; cents: number | null } | null;
}

export interface ReconResult {
  locked: boolean;
  rows: ReconRow[];
  matches: boolean;
}

export function reconcileReport(i: ReconInput): ReconResult {
  const locked = isReportLocked(i.status);
  const rows: ReconRow[] = [
    ...(locked ? [] : [{ label: "Items to report now", count: i.pool.count, cents: i.pool.cents }]),
    { label: "Report row", count: i.report.count, cents: i.report.cents },
    { label: "NAUPA file (summary record)", count: i.file ? i.file.count : null, cents: i.file ? i.file.cents : null, note: "record" as const },
  ];
  const matches = rows.every((r) => r.cents === null || r.cents === rows[0]!.cents);
  return { locked, rows, matches };
}
