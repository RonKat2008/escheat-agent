/**
 * ONE place that counts a report's validation errors and warnings (R3-11). The report builder returns the same
 * validator warnings twice: once as structured `ValidationError`s (persisted, shown on Reports) and once as the
 * rendered strings "record N FIELD: message" in its `warnings` list. Adding the two lists double-counts them
 * (27 vs 13 for the same file). This counts each distinct warning once.
 */
import type { ValidationError } from "./validate";

export interface ValidationSummary {
  errorCount: number;
  /** Distinct warnings: structured validator warnings plus builder-only notes (for example truncation). */
  warningCount: number;
}

/** The string the builder writes for a validator warning (naupa.ts). */
export const renderValidatorWarning = (v: Pick<ValidationError, "record" | "field" | "message">): string =>
  `record ${v.record} ${v.field}: ${v.message}`;

/**
 * @param validation structured validator output (errors and warnings, as persisted on the report).
 * @param builderWarnings the builder's free-text warnings; entries that merely restate a validator warning are ignored.
 */
export function summarizeValidation(validation: readonly ValidationError[], builderWarnings: readonly string[] = []): ValidationSummary {
  const structured = validation.filter((v) => v.severity === "warning");
  const restated = new Set(structured.map(renderValidatorWarning));
  const extra = new Set(builderWarnings.filter((w) => !restated.has(w)));
  return {
    errorCount: validation.filter((v) => v.severity === "error").length,
    warningCount: structured.length + extra.size,
  };
}
