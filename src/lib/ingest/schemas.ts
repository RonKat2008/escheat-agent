import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const optText = z.string().trim().min(1).optional();

export const LEDGER_KINDS = ["check", "payroll_check", "credit", "unapplied_cash"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Canonical ledger row (after column mapping and value parsing). */
export const LedgerRowSchema = z.object({
  kind: z.enum(LEDGER_KINDS).default("check"),
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
