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

export interface ErrorGroupView {
  field?: string;
  message: string;
  count: number;
  lines: number[];
}

export type PipelineView =
  | { status: "ok"; newStale: number; updatedStale: number; notYetStale: number; thresholdDays: number; asOf: string }
  | { status: "error"; message: string };

export interface IngestResultView {
  inserted: number;
  skipped: number;
  /** Total rows rejected (the raw `errors` list is capped server-side). */
  errorCount: number;
  errorGroups: ErrorGroupView[];
  payeesLinked?: number;
  pipeline?: PipelineView;
}

/** Narrow the untyped /api/ingest JSON into what the UI renders. */
export type IngestResponseView =
  | { type: "needsMapping"; suggested: ColumnMapping; headers: string[] }
  | { type: "done"; result: IngestResultView }
  | { type: "error"; message: string; details: string[] };

export const MAX_GROUPS_SHOWN = 8;

/** "648 rows: unknown kind 'x' (kind; lines 2, 3, 4, 5, 6, +643 more)" */
export function describeErrorGroup(g: ErrorGroupView): string {
  const more = g.count - g.lines.length;
  const where = `line${g.lines.length === 1 ? "" : "s"} ${g.lines.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
  return `${g.count} ${g.count === 1 ? "row" : "rows"}: ${g.message} (${g.field ? `${g.field}; ` : ""}${where})`;
}

function readGroups(v: unknown): ErrorGroupView[] {
  return Array.isArray(v) ? (v as ErrorGroupView[]).filter((g) => g && typeof g.message === "string" && typeof g.count === "number") : [];
}

export function interpretIngestResponse(status: number, body: unknown): IngestResponseView {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status >= 400 || typeof b.error === "string") {
    const header = Array.isArray(b.headerErrors) ? (b.headerErrors as unknown[]).map(String) : [];
    const groups = readGroups(b.errorGroups);
    const rows = groups.length > 0
      ? groups.slice(0, MAX_GROUPS_SHOWN).map(describeErrorGroup)
      : Array.isArray(b.errors)
        ? (b.errors as { row?: number; message?: string }[]).slice(0, 10).map((e) => `${e.row ? `line ${e.row}: ` : ""}${e.message ?? "invalid"}`)
        : [];
    const hidden = groups.length - MAX_GROUPS_SHOWN;
    if (hidden > 0) rows.push(`+${hidden} more kinds of error`);
    return { type: "error", message: typeof b.error === "string" ? b.error : `Request failed (${status})`, details: [...header, ...rows] };
  }
  if (b.needsMapping === true && Array.isArray(b.headers) && b.suggested) {
    return { type: "needsMapping", suggested: b.suggested as ColumnMapping, headers: b.headers.map(String) };
  }
  if (typeof b.inserted === "number") {
    const p = b.pipeline as Record<string, unknown> | undefined;
    const pipeline: PipelineView | undefined =
      p?.status === "ok"
        ? {
            status: "ok",
            newStale: Number(p.newStale ?? 0),
            updatedStale: Number(p.updatedStale ?? 0),
            notYetStale: Number(p.notYetStale ?? 0),
            thresholdDays: Number(p.thresholdDays ?? 0),
            asOf: String(p.asOf ?? ""),
          }
        : p?.status === "error"
          ? { status: "error", message: String(p.message ?? "Stale detection failed") }
          : undefined;
    return {
      type: "done",
      result: {
        inserted: b.inserted,
        skipped: typeof b.skipped === "number" ? b.skipped : 0,
        errorCount: typeof b.errorCount === "number" ? b.errorCount : Array.isArray(b.errors) ? b.errors.length : 0,
        errorGroups: readGroups(b.errorGroups),
        payeesLinked: typeof b.payeesLinked === "number" ? b.payeesLinked : undefined,
        ...(pipeline ? { pipeline } : {}),
      },
    };
  }
  return { type: "error", message: "Unexpected response from /api/ingest", details: [] };
}

/** One honest sentence about what detection found after an import. */
export function pipelineHeadline(p: PipelineView): string {
  if (p.status === "error") return p.message;
  if (p.newStale > 0) return `${p.newStale} new stale ${p.newStale === 1 ? "item" : "items"} found`;
  return `0 new stale items; ${p.notYetStale} outstanding ${p.notYetStale === 1 ? "row is" : "rows are"} not yet past the ${p.thresholdDays}-day stale threshold`;
}

/** Mirrors MAX_CSV_CHARS in src/lib/ingest/ingest.ts (the API rejects anything larger); duplicated so the client bundle stays DB-free. */
export const MAX_CSV_BYTES = 10_000_000;

/** Reject files the API would only fail later on: wrong type, empty, or over the size cap. Returns the message, or null when fine. */
export function validateCsvFile(file: { name: string; type: string; size: number }): string | null {
  const looksCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  if (!looksCsv) return `"${file.name}" is not a CSV file. Choose a .csv export.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_CSV_BYTES) return `"${file.name}" is larger than ${MAX_CSV_BYTES / 1_000_000} MB.`;
  return null;
}

export function formatFileSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
