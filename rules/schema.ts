/**
 * Rule-file schema. One file per state at rules/<STATE>.json (history in rules/history/<STATE>/).
 *
 * Hard rules this module enforces:
 *  - every legal value is a RuleValue<T> = { value | null, sources[], verified, todo? };
 *  - a value that does not match its expected shape is NOT guessed: it becomes `null` (=> UNKNOWN downstream)
 *    and a parse warning is recorded (parseRuleFile). Structural problems (bad JSON shape, missing
 *    state/version/propertyTypes, a report stage with no name) reject the file.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ primitives */

export const PROPERTY_TYPES = ["vendor_check", "payroll_check", "customer_credit", "unapplied_cash"] as const;
export type RulePropertyType = (typeof PROPERTY_TYPES)[number];

export const RuleSourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().default(""),
  quote: z.string().default(""),
  retrieved_at: z.string().default(""),
});
export type RuleSource = z.infer<typeof RuleSourceSchema>;

export interface RuleValue<T> {
  value: T | null;
  sources: RuleSource[];
  verified: boolean;
  todo?: string;
  /** Set by approveRuleField: who verified and when (ISO timestamp). */
  verified_by?: string;
  verified_at?: string;
}

/** Strict RuleValue schema around an inner value schema. */
export function ruleValueSchema<S extends z.ZodType>(inner: S) {
  return z.object({
    value: inner.nullable(),
    sources: z.array(RuleSourceSchema).default([]),
    verified: z.boolean().default(false),
    todo: z.string().optional(),
    verified_by: z.string().optional(),
    verified_at: z.string().optional(),
  });
}

/* ------------------------------------------------------------------ value shapes */

export const ClockStartsFromSchema = z.enum(["issue_date", "last_owner_activity", "payable_date"]);
export type ClockStartsFrom = z.infer<typeof ClockStartsFromSchema>;

const month = z.number().int().min(1).max(12);
const day = z.number().int().min(1).max(31);

export const AsOfRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed_cutoff"), month, day }),
  z.object({ type: z.literal("fiscal_year_end") }),
]);
export type AsOfRule = z.infer<typeof AsOfRuleSchema>;

export const DueRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed_date"), month, day, yearOffset: z.number().int() }),
  z.object({ type: z.literal("after_stage"), stage: z.string().min(1), months: z.number().int() }),
  z.object({ type: z.literal("after_stage_days"), stage: z.string().min(1), days: z.number().int() }),
]);
export type DueRule = z.infer<typeof DueRuleSchema>;

export const RemitRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("with_report"), stage: z.string().min(1) }),
  z.object({ type: z.literal("fixed_date"), month, day, yearOffset: z.number().int() }),
  z.object({ type: z.literal("after_stage"), stage: z.string().min(1), months: z.number().int() }),
  z.object({ type: z.literal("after_stage_days"), stage: z.string().min(1), days: z.number().int() }),
]);
export type RemitRule = z.infer<typeof RemitRuleSchema>;

export const WindowDaysSchema = z
  .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative().nullable() })
  .refine((w) => w.max === null || w.min <= w.max, { message: "min must be <= max" });
export type WindowDays = z.infer<typeof WindowDaysSchema>;

export const InterestSchema = z.object({ annualRatePct: z.number().nonnegative(), basis: z.string() });
export type InterestRule = z.infer<typeof InterestSchema>;

const cents = z.number().int().nonnegative();
const dormancy = z.number().positive();

/* ------------------------------------------------------------------ strict file schema */

const PropertyTypeRuleSchema = z.object({
  naupaCode: ruleValueSchema(z.string()),
  dormancyYears: ruleValueSchema(dormancy),
  clockStartsFrom: ruleValueSchema(ClockStartsFromSchema),
  minAmountCents: ruleValueSchema(cents),
  aggregateThresholdCents: ruleValueSchema(cents),
});
export type PropertyTypeRule = z.infer<typeof PropertyTypeRuleSchema>;

const DueDiligenceSchema = z.object({
  required: ruleValueSchema(z.boolean()),
  minAmountCents: ruleValueSchema(cents),
  windowDaysBeforeReport: ruleValueSchema(WindowDaysSchema),
  mailingMethod: ruleValueSchema(z.string()),
  requiredLanguage: ruleValueSchema(z.string()),
});
export type DueDiligenceRule = z.infer<typeof DueDiligenceSchema>;

const ReportStageSchema = z.object({
  name: z.string().min(1),
  asOfRule: ruleValueSchema(AsOfRuleSchema),
  dueRule: ruleValueSchema(DueRuleSchema),
  includesRemittance: z.boolean().default(false),
});
export type ReportStageRule = z.infer<typeof ReportStageSchema>;

export const RuleFileSchema = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  version: z.string().min(1),
  researched_at: z.string().default(""),
  researched_by: z.string().default(""),
  propertyTypes: z.object({
    vendor_check: PropertyTypeRuleSchema.optional(),
    payroll_check: PropertyTypeRuleSchema.optional(),
    customer_credit: PropertyTypeRuleSchema.optional(),
    unapplied_cash: PropertyTypeRuleSchema.optional(),
  }),
  dueDiligence: DueDiligenceSchema,
  reportStages: z.array(ReportStageSchema),
  remitRule: ruleValueSchema(RemitRuleSchema),
  businessDayRollForward: ruleValueSchema(z.boolean()),
  interest: ruleValueSchema(InterestSchema),
  electronicFormat: z.unknown().optional(),
  portal: z.unknown().optional(),
  notes: z.array(z.string()).default([]),
});
export type RuleFile = z.infer<typeof RuleFileSchema>;

/* ------------------------------------------------------------------ tolerant parsing */

export interface ParseWarning {
  path: string;
  message: string;
}

export type ParseRuleFileResult =
  | { ok: true; file: RuleFile; warnings: ParseWarning[] }
  | { ok: false; errors: string[]; warnings: ParseWarning[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function emptyValue<T>(todo: string): RuleValue<T> {
  return { value: null, sources: [], verified: false, todo };
}

/**
 * Coerce one raw RuleValue. Accepts a proper wrapper `{value, sources, verified}` or, leniently, a bare
 * value (treated as unverified with no sources). A value that fails `inner` becomes null + warning.
 *
 */
function coerceValue<S extends z.ZodType>(
  raw: unknown,
  inner: S,
  path: string,
  warnings: ParseWarning[],
): RuleValue<z.infer<S>> {
  if (raw === undefined) {
    warnings.push({ path, message: "missing; treated as unknown" });
    return emptyValue("missing in rule file");
  }
  const wrapped = isObj(raw) && "value" in raw && ("sources" in raw || "verified" in raw || Object.keys(raw).length <= 3);
  const rawValue = wrapped ? (raw as Record<string, unknown>).value : raw;
  const meta = wrapped ? (raw as Record<string, unknown>) : {};

  const sources: RuleSource[] = [];
  if (Array.isArray(meta.sources)) {
    meta.sources.forEach((s, i) => {
      const r = RuleSourceSchema.safeParse(s);
      if (r.success) sources.push(r.data);
      else warnings.push({ path: `${path}.sources[${i}]`, message: "malformed source dropped" });
    });
  }

  let value: z.infer<S> | null = null;
  if (rawValue !== null && rawValue !== undefined) {
    const r = inner.safeParse(rawValue);
    if (r.success) value = r.data as z.infer<S>;
    else
      warnings.push({
        path,
        message: `value does not match expected shape (${r.error.issues[0]?.message ?? "invalid"}); treated as unknown`,
      });
  }
  const out: RuleValue<z.infer<S>> = {
    value,
    sources,
    // A null value may still be verified ("researched; statute is silent"). Engines treat null as UNKNOWN regardless.
    verified: meta.verified === true,
  };
  if (typeof meta.todo === "string") out.todo = meta.todo;
  else if (value === null) out.todo = "value unknown";
  if (typeof meta.verified_by === "string") out.verified_by = meta.verified_by;
  if (typeof meta.verified_at === "string") out.verified_at = meta.verified_at;
  return out;
}

function includesRemittanceOf(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return isObj(v) && v.value === true;
}

export function parseRuleFile(raw: unknown): ParseRuleFileResult {
  const warnings: ParseWarning[] = [];
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["rule file must be a JSON object"], warnings };

  const state = raw.state;
  if (typeof state !== "string" || !/^[A-Z]{2}$/.test(state)) errors.push("state must be a 2-letter uppercase code");
  if (typeof raw.version !== "string" || !raw.version) errors.push("version must be a non-empty string");
  if (!isObj(raw.propertyTypes)) errors.push("propertyTypes must be an object");
  if (!Array.isArray(raw.reportStages)) errors.push("reportStages must be an array");
  if (errors.length) return { ok: false, errors, warnings };

  const ptRaw = raw.propertyTypes as Record<string, unknown>;
  const propertyTypes: Record<string, PropertyTypeRule> = {};
  for (const [name, ptv] of Object.entries(ptRaw)) {
    if (!(PROPERTY_TYPES as readonly string[]).includes(name)) {
      warnings.push({ path: `propertyTypes.${name}`, message: "unknown property type ignored" });
      continue;
    }
    if (!isObj(ptv)) {
      errors.push(`propertyTypes.${name} must be an object`);
      continue;
    }
    const p = `propertyTypes.${name}`;
    propertyTypes[name] = {
      naupaCode: coerceValue(ptv.naupaCode, z.string().min(1), `${p}.naupaCode`, warnings),
      dormancyYears: coerceValue(ptv.dormancyYears, dormancy, `${p}.dormancyYears`, warnings),
      clockStartsFrom: coerceValue(ptv.clockStartsFrom, ClockStartsFromSchema, `${p}.clockStartsFrom`, warnings),
      minAmountCents: coerceValue(ptv.minAmountCents, cents, `${p}.minAmountCents`, warnings),
      aggregateThresholdCents: coerceValue(ptv.aggregateThresholdCents, cents, `${p}.aggregateThresholdCents`, warnings),
    };
  }

  const dd = isObj(raw.dueDiligence) ? raw.dueDiligence : {};
  if (!isObj(raw.dueDiligence)) warnings.push({ path: "dueDiligence", message: "missing; all due diligence values unknown" });
  const dueDiligence: DueDiligenceRule = {
    required: coerceValue(dd.required, z.boolean(), "dueDiligence.required", warnings),
    minAmountCents: coerceValue(dd.minAmountCents, cents, "dueDiligence.minAmountCents", warnings),
    windowDaysBeforeReport: coerceValue(dd.windowDaysBeforeReport, WindowDaysSchema, "dueDiligence.windowDaysBeforeReport", warnings),
    mailingMethod: coerceValue(dd.mailingMethod, z.string(), "dueDiligence.mailingMethod", warnings),
    requiredLanguage: coerceValue(dd.requiredLanguage, z.string(), "dueDiligence.requiredLanguage", warnings),
  };

  const reportStages: ReportStageRule[] = [];
  (raw.reportStages as unknown[]).forEach((st, i) => {
    if (!isObj(st) || typeof st.name !== "string" || !st.name) {
      errors.push(`reportStages[${i}] must be an object with a name`);
      return;
    }
    const p = `reportStages[${i}]`;
    reportStages.push({
      name: st.name,
      asOfRule: coerceValue(st.asOfRule, AsOfRuleSchema, `${p}.asOfRule`, warnings),
      dueRule: coerceValue(st.dueRule, DueRuleSchema, `${p}.dueRule`, warnings),
      // Real files wrap this as a RuleValue<boolean>; older/simple files use a bare boolean. Both accepted.
      includesRemittance: includesRemittanceOf(st.includesRemittance),
    });
  });
  const names = reportStages.map((s) => s.name);
  if (new Set(names).size !== names.length) errors.push("reportStages names must be unique");
  if (errors.length) return { ok: false, errors, warnings };

  const candidate = {
    state: raw.state as string,
    version: raw.version as string,
    researched_at: typeof raw.researched_at === "string" ? raw.researched_at : "",
    researched_by: typeof raw.researched_by === "string" ? raw.researched_by : "",
    propertyTypes,
    dueDiligence,
    reportStages,
    remitRule: coerceValue(raw.remitRule, RemitRuleSchema, "remitRule", warnings),
    businessDayRollForward: coerceValue(raw.businessDayRollForward, z.boolean(), "businessDayRollForward", warnings),
    interest: coerceValue(raw.interest, InterestSchema, "interest", warnings),
    electronicFormat: raw.electronicFormat,
    portal: raw.portal,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === "string") : [],
  };
  const final = RuleFileSchema.safeParse(candidate);
  if (!final.success) {
    return { ok: false, errors: final.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), warnings };
  }
  return { ok: true, file: final.data, warnings };
}
