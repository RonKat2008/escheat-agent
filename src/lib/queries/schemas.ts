/** Zod-typed outputs of the read-model, shared by the dashboard UI and the MCP server. */
import { z } from "zod";

export const MoneySchema = z.object({ cents: z.number().int(), formatted: z.string() });
export type Money = z.infer<typeof MoneySchema>;

export const StaleStatusSchema = z.enum([
  "watching",
  "dd_pending",
  "dd_sent",
  "owner_responded",
  "resolved_paid",
  "to_report",
  "reported",
  "remitted",
  "needs_rule",
]);
export const PropertyTypeSchema = z.enum(["vendor_check", "payroll_check", "customer_credit", "unapplied_cash"]);
const IsoDateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ExposureSchema = z.object({
  asOf: IsoDateStr,
  totalCents: z.number().int(),
  total: MoneySchema,
  itemCount: z.number().int(),
  anyUnverified: z.boolean(),
  byState: z.array(
    z.object({ state: z.string(), cents: z.number().int(), formatted: z.string(), count: z.number().int(), anyUnverified: z.boolean() }),
  ),
  byStatus: z.array(z.object({ status: StaleStatusSchema, cents: z.number().int(), formatted: z.string(), count: z.number().int() })),
  byPropertyType: z.array(z.object({ propertyType: PropertyTypeSchema, cents: z.number().int(), formatted: z.string(), count: z.number().int() })),
});
export type Exposure = z.infer<typeof ExposureSchema>;

export const DeadlineKindSchema = z.enum(["dd_window_start", "dd_window_end", "report_due", "remit_due"]);
export type DeadlineKind = z.infer<typeof DeadlineKindSchema>;

export const NextDeadlineSchema = z.object({ kind: DeadlineKindSchema, date: IsoDateStr, verified: z.boolean() });

export const StaleItemRowSchema = z.object({
  id: z.string(),
  ledgerItemId: z.string(),
  payeeName: z.string(),
  payeeNameRaw: z.string(),
  checkNumber: z.string().nullable(),
  propertyType: PropertyTypeSchema,
  amount: MoneySchema,
  issueDate: IsoDateStr,
  ageDays: z.number().int(),
  ownerState: z.string().nullable(),
  ownerStateBasis: z.enum(["address", "incorporation"]).nullable(),
  status: StaleStatusSchema,
  needsReview: z.boolean(),
  dependsOnUnverified: z.boolean(),
  ruleVersion: z.string().nullable(),
  nextDeadline: NextDeadlineSchema.nullable(),
});
export type StaleItemRow = z.infer<typeof StaleItemRowSchema>;

export const StaleItemListSchema = z.object({
  asOf: IsoDateStr,
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  items: z.array(StaleItemRowSchema),
});
export type StaleItemList = z.infer<typeof StaleItemListSchema>;

export const DeadlineEventSchema = z.object({
  date: IsoDateStr,
  kind: DeadlineKindSchema,
  daysUntil: z.number().int(),
  verified: z.boolean(),
  itemId: z.string(),
  checkNumber: z.string().nullable(),
  payeeName: z.string(),
  state: z.string().nullable(),
  amount: MoneySchema,
  status: StaleStatusSchema,
});
export type DeadlineEvent = z.infer<typeof DeadlineEventSchema>;

export const SortSchema = z.enum(["age_desc", "age_asc", "amount_desc", "amount_asc", "payee_asc", "deadline_asc"]);
export type StaleSort = z.infer<typeof SortSchema>;

export const ListFiltersSchema = z.object({
  state: z.string().length(2).optional(),
  status: StaleStatusSchema.optional(),
  propertyType: PropertyTypeSchema.optional(),
  minAgeDays: z.number().int().nonnegative().optional(),
  maxAgeDays: z.number().int().nonnegative().optional(),
  search: z.string().optional(),
  needsReview: z.boolean().optional(),
  includeClosed: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
  sort: SortSchema.default("age_desc"),
});
export type ListFilters = z.input<typeof ListFiltersSchema>;

export const RuleSourceOutSchema = z.object({ url: z.string(), title: z.string(), quote: z.string() });

export const TimelineEventSchema = z.object({
  key: z.enum(["presumed_abandoned", "dd_window_start", "dd_window_end", "report_due", "remit_due"]),
  label: z.string(),
  date: IsoDateStr.nullable(),
  status: z.enum(["ok", "unknown", "not_applicable"]),
  verified: z.boolean(),
  ruleVersion: z.string().nullable(),
  rulePaths: z.array(z.string()),
  sources: z.array(RuleSourceOutSchema),
  notes: z.array(z.string()),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const ExplainSchema = z.object({
  asOf: IsoDateStr,
  item: StaleItemRowSchema.extend({ staleSince: IsoDateStr, reportStage: z.string().nullable(), classification: z.record(z.string(), z.unknown()).nullable() }),
  ledger: z.object({
    referenceNumber: z.string().nullable(),
    issueDate: IsoDateStr,
    lastActivityDate: IsoDateStr.nullable(),
    status: z.string(),
    memo: z.string().nullable(),
    address: z.string(),
    source: z.string(),
  }),
  payee: z
    .object({ id: z.string(), canonicalName: z.string(), aliases: z.array(z.string()), address: z.string(), mergeBasis: z.string(), mergeConfidence: z.number().nullable() })
    .nullable(),
  rules: z.object({ state: z.string().nullable(), pinnedVersion: z.string().nullable(), loaded: z.boolean(), note: z.string().nullable() }),
  timeline: z.array(TimelineEventSchema),
  warnings: z.array(z.string()),
  outreach: z.array(
    z.object({ id: z.string(), channel: z.string(), status: z.string(), toAddress: z.string().nullable(), subject: z.string().nullable(), sentAt: z.string().nullable(), createdAt: z.string() }),
  ),
  approvals: z.array(
    z.object({ id: z.string(), action: z.string(), subjectId: z.string(), approvedBy: z.string().nullable(), approvedAt: z.string().nullable(), consumedAt: z.string().nullable() }),
  ),
  agentRuns: z.array(
    z.object({ id: z.string(), agent: z.string(), model: z.string().nullable(), status: z.string(), startedAt: z.string(), error: z.string().nullable() }),
  ),
});
export type Explanation = z.infer<typeof ExplainSchema>;

export const InterestExposureSchema = z.object({
  asOf: IsoDateStr,
  label: z.string(),
  totalCents: z.number().int().nullable(),
  total: MoneySchema.nullable(),
  anyUnknown: z.boolean(),
  anyUnverified: z.boolean(),
  byState: z.array(
    z.object({
      state: z.string(),
      itemCount: z.number().int(),
      principal: MoneySchema,
      status: z.enum(["ok", "unknown"]),
      interest: MoneySchema.nullable(),
      verified: z.boolean(),
      label: z.string(),
      ruleVersion: z.string().nullable(),
      sources: z.array(RuleSourceOutSchema),
      notes: z.array(z.string()),
    }),
  ),
});
export type InterestExposure = z.infer<typeof InterestExposureSchema>;
