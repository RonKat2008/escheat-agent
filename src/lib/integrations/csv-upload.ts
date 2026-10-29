import type { ColumnMapping, FieldType } from "@/lib/ingest/mapping";
import type { IngestKind } from "@/lib/ingest/schemas";

/** Canonical fields offered in the mapping step, with the parser type each needs. */
export interface FieldDef {
  field: string;
  label: string;
  type: FieldType;
  required: boolean;
}

export const LEDGER_FIELDS: readonly FieldDef[] = [
  { field: "payeeName", label: "Payee name", type: "string", required: true },
  { field: "amount", label: "Amount", type: "amount", required: true },
  { field: "issueDate", label: "Issue date", type: "date", required: true },
  { field: "number", label: "Check number", type: "string", required: false },
  { field: "kind", label: "Item kind", type: "string", required: false },
  { field: "payeeAddress", label: "Payee address", type: "string", required: false },
  { field: "payeeCity", label: "Payee city", type: "string", required: false },
  { field: "payeeState", label: "Payee state", type: "string", required: false },
  { field: "payeeZip", label: "Payee ZIP", type: "string", required: false },
  { field: "voided", label: "Voided", type: "boolean", required: false },
  { field: "memo", label: "Memo", type: "string", required: false },
];

export const CLEAR_FIELDS: readonly FieldDef[] = [
  { field: "amount", label: "Amount", type: "amount", required: true },
  { field: "clearedDate", label: "Cleared date", type: "date", required: true },
  { field: "checkNumber", label: "Check number", type: "string", required: false },
  { field: "description", label: "Description", type: "string", required: false },
];

export const fieldsFor = (kind: IngestKind): readonly FieldDef[] => (kind === "ledger" ? LEDGER_FIELDS : CLEAR_FIELDS);

/** Set (or clear, with null/"") the source header for one canonical field. Pure: returns a new mapping. */
export function setColumn(mapping: ColumnMapping, kind: IngestKind, field: string, header: string | null): ColumnMapping {
  const columns = { ...mapping.columns };
  const types = { ...(mapping.types ?? {}) };
  if (!header) {
    delete columns[field];
    delete types[field];
  } else {
    columns[field] = header;
    const def = fieldsFor(kind).find((f) => f.field === field);
    if (def && def.type !== "string") types[field] = def.type;
  }
  // `required` from a suggestion may name fields that were just unmapped; recompute from what is mapped.
  const required = fieldsFor(kind)
    .filter((f) => f.required || (mapping.required ?? []).includes(f.field))
    .map((f) => f.field)
    .filter((f) => f in columns);
  return { ...mapping, columns, types, required };
}

/** Required canonical fields that have no source column yet. */
export function missingRequired(mapping: ColumnMapping, kind: IngestKind): string[] {
  return fieldsFor(kind)
    .filter((f) => f.required && !mapping.columns[f.field])
    .map((f) => f.label);
}

/** Headers claimed by more than one canonical field (usually a mistake). */
export function duplicateHeaders(mapping: ColumnMapping): string[] {
  const count = new Map<string, number>();
  for (const h of Object.values(mapping.columns)) count.set(h, (count.get(h) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([h]) => h);
}

export interface IngestResultView {
  inserted: number;
  skipped: number;
  errors: { row?: number; message: string; field?: string }[];
  payeesLinked?: number;
}

/** Narrow the untyped /api/ingest JSON into what the UI renders. */
export type IngestResponseView =
  | { type: "needsMapping"; suggested: ColumnMapping; headers: string[] }
  | { type: "done"; result: IngestResultView }
  | { type: "error"; message: string; details: string[] };

export function interpretIngestResponse(status: number, body: unknown): IngestResponseView {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status >= 400 || typeof b.error === "string") {
    const header = Array.isArray(b.headerErrors) ? (b.headerErrors as unknown[]).map(String) : [];
    const rows = Array.isArray(b.errors)
      ? (b.errors as { row?: number; message?: string }[]).slice(0, 10).map((e) => `${e.row ? `row ${e.row}: ` : ""}${e.message ?? "invalid"}`)
      : [];
    return { type: "error", message: typeof b.error === "string" ? b.error : `Request failed (${status})`, details: [...header, ...rows] };
  }
  if (b.needsMapping === true && Array.isArray(b.headers) && b.suggested) {
    return { type: "needsMapping", suggested: b.suggested as ColumnMapping, headers: b.headers.map(String) };
  }
  if (typeof b.inserted === "number") {
    return {
      type: "done",
      result: {
        inserted: b.inserted,
        skipped: typeof b.skipped === "number" ? b.skipped : 0,
        errors: Array.isArray(b.errors) ? (b.errors as IngestResultView["errors"]) : [],
        payeesLinked: typeof b.payeesLinked === "number" ? b.payeesLinked : undefined,
      },
    };
  }
  return { type: "error", message: "Unexpected response from /api/ingest", details: [] };
}
