/**
 * Single source of truth for the four vocabularies a ledger line is described in:
 *  - PropertyType  (DB enum / fixtures / rules): vendor_check | payroll_check | customer_credit | unapplied_cash
 *  - IngestKind    (CSV/QBO input):               check | payroll_check | credit | unapplied_cash
 *  - ClassifierKind (classifier input):           check | credit | unapplied_cash
 *  - ReconKind     (reconciliation):              check | credit | unapplied_cash
 * Every loader/ingest/classifier path converts through this module; do not re-map ad hoc.
 */
export const PROPERTY_TYPE_VALUES = ["vendor_check", "payroll_check", "customer_credit", "unapplied_cash"] as const;
export type CanonicalPropertyType = (typeof PROPERTY_TYPE_VALUES)[number];

export const INGEST_KIND_VALUES = ["check", "payroll_check", "credit", "unapplied_cash"] as const;
export type IngestLedgerKind = (typeof INGEST_KIND_VALUES)[number];

export const CLASSIFIER_KIND_VALUES = ["check", "credit", "unapplied_cash"] as const;
export type ClassifierKind = (typeof CLASSIFIER_KIND_VALUES)[number];

export type ReconKindValue = ClassifierKind;

const FROM_INGEST: Record<IngestLedgerKind, CanonicalPropertyType> = {
  check: "vendor_check",
  payroll_check: "payroll_check",
  credit: "customer_credit",
  unapplied_cash: "unapplied_cash",
};

const TO_CLASSIFIER: Record<CanonicalPropertyType, ClassifierKind> = {
  vendor_check: "check",
  payroll_check: "check",
  customer_credit: "credit",
  unapplied_cash: "unapplied_cash",
};

export const propertyTypeFromIngestKind = (k: IngestLedgerKind): CanonicalPropertyType => FROM_INGEST[k];

export const classifierKindOfPropertyType = (t: CanonicalPropertyType): ClassifierKind => TO_CLASSIFIER[t];

/** Recon only distinguishes check / credit / unapplied cash. */
export const reconKindOfPropertyType = classifierKindOfPropertyType;

/**
 * Normalise any known kind spelling (property type, ingest kind or classifier kind) to a classifier kind.
 * Returns undefined for unknown values so schema validation can reject them.
 */
export function normalizeClassifierKind(value: unknown): ClassifierKind | undefined {
  if (typeof value !== "string") return undefined;
  if ((CLASSIFIER_KIND_VALUES as readonly string[]).includes(value)) return value as ClassifierKind;
  if (value in TO_CLASSIFIER) return TO_CLASSIFIER[value as CanonicalPropertyType];
  return undefined;
}
