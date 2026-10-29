import { z } from "zod";

export const DEMO_ANCHOR_DATE = "2026-11-01";
export const DEFAULT_SEED = 10482;
export const STALE_THRESHOLD_DAYS = 180;
export const HOLDER_INCORPORATION_STATE = "DE";

export const PROPERTY_TYPES = [
  "vendor_check",
  "payroll_check",
  "customer_credit",
  "unapplied_cash",
] as const;
export type SynthPropertyType = (typeof PROPERTY_TYPES)[number];

/** Generic export kinds that appear only in hand-written adversarial cases (memo decides the type). */
export const GENERIC_KINDS = ["check", "credit"] as const;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One row of fixtures/synthetic/ledger.csv, in typed form. */
export const ledgerRowSchema = z.object({
  kind: z.enum(PROPERTY_TYPES),
  number: z.string().min(1),
  payee_name: z.string().min(1),
  payee_address: z.string(),
  payee_city: z.string(),
  payee_state: z.string(),
  payee_zip: z.string(),
  amount_cents: z.number().int().positive(),
  issue_date: isoDate,
  voided: z.boolean(),
  memo: z.string(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/** One row of fixtures/synthetic/bank_clears.csv, in typed form. */
export const clearRowSchema = z.object({
  check_number: z.string().min(1),
  amount_cents: z.number().int().positive(),
  cleared_date: isoDate,
  description: z.string(),
});
export type ClearRow = z.infer<typeof clearRowSchema>;

export interface SyntheticCompany {
  name: string;
  incorporation_state: string;
  hq_state: string;
  address_line: string;
  city: string;
  zip: string;
  fiscal_year_end: string;
  fein: null;
  is_synthetic: true;
}

export interface SyntheticDataset {
  seed: number;
  anchor: string;
  company: SyntheticCompany;
  ledger: LedgerRow[];
  clears: ClearRow[];
}

export const evalItemSchema = z.object({
  kind: z.enum([...PROPERTY_TYPES, ...GENERIC_KINDS]),
  number: z.string(),
  payee_name: z.string(),
  payee_address: z.string(),
  payee_city: z.string(),
  payee_state: z.string(),
  payee_zip: z.string(),
  amount_cents: z.number().int().positive(),
  issue_date: isoDate,
  memo: z.string(),
  /** Bank clearing status is part of the snapshot: null = not cleared on/before the anchor. */
  cleared_date: isoDate.nullable(),
});
export type EvalItem = z.infer<typeof evalItemSchema>;

export const evalExpectedSchema = z.object({
  property_type: z.enum(PROPERTY_TYPES),
  owner_state: z.string().regex(/^[A-Z]{2}$/),
  owner_state_basis: z.enum(["address", "incorporation"]),
  is_stale: z.boolean(),
});

export const evalCaseSchema = z.object({
  id: z.string().min(1),
  slice: z.enum(["generated", "adversarial"]),
  item: evalItemSchema,
  expected: evalExpectedSchema,
});
export type EvalCaseFixture = z.infer<typeof evalCaseSchema>;
