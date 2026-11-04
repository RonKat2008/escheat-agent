import { createLoader, parseAsBoolean, parseAsNumberLiteral, parseAsStringLiteral } from "nuqs/server";
import { AUDIT_STATES, DEFAULT_SAMPLE_SIZE, SAMPLE_SIZES, type AuditState } from "@/lib/audit/sample";

export const STATE_NAMES: Record<AuditState, string> = { CA: "California", DE: "Delaware", TX: "Texas" };

/**
 * URL state for /audit. A drill runs only once a state is in the URL (the "Simulate audit request" form submits it
 * with a GET), so a shared link reproduces the exact same sample.
 */
export const auditParsers = {
  state: parseAsStringLiteral(AUDIT_STATES),
  size: parseAsNumberLiteral(SAMPLE_SIZES).withDefault(DEFAULT_SAMPLE_SIZE),
  all: parseAsBoolean.withDefault(false),
};

export const loadAuditParams = createLoader(auditParsers);

/** The binder URL for the same sample the page shows. */
export function binderHref(state: AuditState, size: number, all: boolean): string {
  return `/api/audit/${state}/binder?size=${size}${all ? "&all=true" : ""}`;
}
