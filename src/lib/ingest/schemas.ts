import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const optText = z.string().trim().min(1).optional();

export const LEDGER_KINDS = ["check", "payroll_check", "credit", "unapplied_cash"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Accepted spellings of each canonical kind, including the synthetic generator's (vendor_check, customer_credit). */
const KIND_ALIASES: Record<string, LedgerKind> = {
  check: "check",
  vendor_check: "check",
  vendor: "check",
  ap_check: "check",
  payroll_check: "payroll_check",
  payroll: "payroll_check",
  credit: "credit",
  customer_credit: "credit",
  credit_memo: "credit",
  unapplied_cash: "unapplied_cash",
  unapplied: "unapplied_cash",
};

/** Case/space/dash-insensitive; unknown values pass through so the enum can reject them by name. */
export function normalizeKind(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return KIND_ALIASES[key] ?? raw;
}

const kindSchema = z.preprocess(
  normalizeKind,
  z.enum(LEDGER_KINDS, { error: (iss) => `unknown kind '${String(iss.input)}'` }).default("check"),
);

/** Canonical ledger row (after column mapping and value parsing). */
export const LedgerRowSchema = z.object({
  kind: kindSchema,
  number: optText,
  payeeName: z.string().trim().min(1, "payee name is required"),
  payeeAddress: optText,
  payeeCity: optText,
  payeeState: optText,
  payeeZip: optText,
  amount: z.number().int(),
  issueDate: isoDate,
  voided: z.boolean().default(false),
  memo: optText,
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

/** Canonical bank-clear row. */
export const ClearRowSchema = z.object({
  checkNumber: optText,
  amount: z.number().int(),
  clearedDate: isoDate,
  description: optText,
});
export type ClearRow = z.infer<typeof ClearRowSchema>;

export const INGEST_KINDS = ["ledger", "clears"] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];
