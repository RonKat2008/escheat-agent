/** Display helpers shared by the UI. Dates are ISO YYYY-MM-DD strings; never pass them through Date with a timezone. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  return opts.year === false ? `${month} ${day}` : `${month} ${day}, ${m[1]}`;
}

/** "in 24d" / "today" / "12d ago" */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  return days > 0 ? `in ${formatSpan(days)}` : `${formatSpan(-days)} ago`;
}

/** Compact span: 24d, 14mo, 3.2y */
export function formatSpan(days: number): string {
  if (days < 60) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30.4)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

export const PROPERTY_TYPE_LABEL: Record<string, string> = {
  vendor_check: "Vendor check",
  payroll_check: "Payroll check",
  customer_credit: "Customer credit",
  unapplied_cash: "Unapplied cash",
};

export const DEADLINE_LABEL: Record<string, string> = {
  dd_window_start: "Due diligence opens",
  dd_window_end: "Due diligence closes",
  report_due: "Report due",
  remit_due: "Remit due",
};
