/**
 * Zod-free enum value lists. Client bundles (the Items URL parsers) import these instead of schemas.ts so zod stays
 * out of the browser; schemas.ts builds its z.enum() from the same arrays, so the two can never drift.
 */
export const STALE_STATUS_VALUES = ["watching", "dd_pending", "dd_sent", "owner_responded", "resolved_paid", "to_report", "reported", "remitted", "needs_rule"] as const;
export const PROPERTY_TYPE_VALUES = ["vendor_check", "payroll_check", "customer_credit", "unapplied_cash"] as const;
export const SORT_VALUES_BASE = ["age_desc", "age_asc", "amount_desc", "amount_asc", "payee_asc", "deadline_asc"] as const;
export const LIST_SORT_VALUES = [...SORT_VALUES_BASE, "payee_desc", "deadline_desc"] as const;
