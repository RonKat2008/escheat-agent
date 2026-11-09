import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { companies } from "@/db/schema";
import * as clock from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { detectStaleItems, type DetectOptions } from "@/lib/pipeline/detect";
import { checkCsvSyntax, parseCsv, readHeaders, type ParseError, type ParseResult } from "./csv";
import { groupParseErrors, type ErrorGroup } from "./errors";
import { ColumnMappingSchema, suggestMapping, type ColumnMapping } from "./mapping";
import { insertClearRows, insertLedgerRows, resolvePayees } from "./persist";
import { clearPlausibility, ledgerPlausibility } from "./plausibility";
import { ClearRowSchema, INGEST_KINDS, LedgerRowSchema } from "./schemas";

export const MAX_CSV_CHARS = 10_000_000;
/** Raw per-row errors returned alongside the grouped view; the full count is in `errorCount`. */
export const MAX_RAW_ERRORS = 100;

export const IngestRequestSchema = z.object({
  kind: z.enum(INGEST_KINDS),
  csv: z.string().min(1, "csv is empty").max(MAX_CSV_CHARS, "csv is too large"),
  mapping: ColumnMappingSchema.optional(),
  companyId: z.uuid(),
  /**
   * Dry run (Ask's upload card): parse and validate with `mapping` exactly as an import would, return the valid-row
   * count, a few sample rows and every row error, and store nothing. Requires `mapping`.
   */
  preview: z.boolean().optional(),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

/** What the deterministic pipeline did after an import (stale detection + owner state + timelines). */
export type PipelineReport =
  | {
      status: "ok";
      asOf: string;
      newStale: number;
      updatedStale: number;
      /** Outstanding rows not yet past the business stale threshold. */
      notYetStale: number;
      thresholdDays: number;
      needsReview: number;
    }
  | { status: "error"; message: string };

export interface RowErrorReport {
  errors: ParseError[];
  errorCount: number;
  errorGroups: ErrorGroup[];
}

/** Rows shown in a dry-run preview. */
export const PREVIEW_SAMPLE_ROWS = 5;

/** One parsed row as the preview shows it: canonical field -> display text (amounts in cents become dollars). */
export type PreviewRow = Record<string, string>;

export type IngestOutcome =
  | { status: 200; body: { needsMapping: true; suggested: ColumnMapping; headers: string[] } }
  | { status: 200; body: { preview: { validRows: number; sample: PreviewRow[] } & RowErrorReport } }
  | {
      status: 200;
      body: { inserted: number; skipped: number; payeesLinked?: number; pipeline?: PipelineReport } & RowErrorReport;
    }
  | {
      status: 404 | 422;
      body: { error: string; errorType?: "parse" | "mapping" | "rows"; headerErrors?: string[] } & Partial<RowErrorReport>;
    };

export interface IngestDeps {
  /** Test seam for the classifier used by post-import stale detection. */
  classify?: DetectOptions["classify"];
}

function rowErrors(errors: ParseError[]): RowErrorReport {
  return { errors: errors.slice(0, MAX_RAW_ERRORS), errorCount: errors.length, errorGroups: groupParseErrors(errors) };
}

type Failure = Extract<IngestOutcome, { body: { error: string } }>;

function failure<T>(parsed: ParseResult<T>): Failure | null {
  if (parsed.parseError) {
    const { line, message } = parsed.parseError;
    return { status: 422, body: { error: `CSV parse error at line ${line}: ${message}`, errorType: "parse" } };
  }
  if (parsed.headerErrors.length > 0) {
    return {
      status: 422,
      body: { error: "Column mapping does not fit this CSV", errorType: "mapping", headerErrors: parsed.headerErrors },
    };
  }
  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    return { status: 422, body: { error: "No valid rows", errorType: "rows", ...rowErrors(parsed.errors) } };
  }
  return null;
}

async function runPipeline(db: Db, companyId: string, deps: IngestDeps): Promise<PipelineReport> {
  try {
    const s = await detectStaleItems(db, companyId, deps.classify ? { classify: deps.classify } : {});
    return {
      status: "ok",
      asOf: s.asOf,
      newStale: s.inserted,
      updatedStale: s.updated,
      notYetStale: s.skippedNotStale,
      thresholdDays: s.thresholdDays,
      needsReview: s.needsReview,
    };
  } catch (err) {
    console.error("[ingest] pipeline failed", err);
    return { status: "error", message: "Rows were imported, but stale detection failed. Run detection from the Items page." };
  }
}

function displayCell(field: string, value: unknown): string {
  if (typeof value === "number" && field === "amount") return (value / 100).toFixed(2);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value === undefined || value === null ? "" : String(value);
}

/** Dry run: what an import WOULD store and reject. Writes nothing. */
function previewOf<T extends object>(parsed: ParseResult<T>): IngestOutcome {
  const sample = parsed.rows
    .slice(0, PREVIEW_SAMPLE_ROWS)
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, displayCell(k, v)])));
  return { status: 200, body: { preview: { validRows: parsed.rows.length, sample, ...rowErrors(parsed.errors) } } };
}

/** R11-07: what the chain records about a CSV import besides the rows themselves: a digest of the exact file. */
function importAudit(req: IngestRequest): { fileSha256: string; via: string } {
  return { fileSha256: sha256Hex(req.csv), via: "csv_import" };
}

/** Core of POST /api/ingest, separated from the route so it is testable against any Db. */
export async function ingestCsv(db: Db, req: IngestRequest, deps: IngestDeps = {}): Promise<IngestOutcome> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, req.companyId));
  if (!company) return { status: 404, body: { error: "Company not found" } };

  if (!req.mapping) {
    const bad = checkCsvSyntax(req.csv);
    if (bad) {
      return { status: 422, body: { error: `CSV parse error at line ${bad.line}: ${bad.message}`, errorType: "parse" } };
    }
    const headers = readHeaders(req.csv);
    if (headers.length === 0) return { status: 422, body: { error: "Could not read a header row from the CSV" } };
    return { status: 200, body: { needsMapping: true, suggested: suggestMapping(headers, req.kind), headers } };
  }

  const today = await clock.now(db, req.companyId);

  if (req.kind === "ledger") {
    const parsed = parseCsv(req.csv, req.mapping, LedgerRowSchema, { refine: ledgerPlausibility(today) });
    const failed = failure(parsed);
    if (failed) return failed;
    if (req.preview) return previewOf(parsed);
    const summary = await insertLedgerRows(db, req.companyId, parsed.rows, parsed.raws, { audit: importAudit(req) });
    const linked = await resolvePayees(db, req.companyId);
    const pipeline = summary.inserted > 0 ? await runPipeline(db, req.companyId, deps) : undefined;
    return {
      status: 200,
      body: { ...summary, ...rowErrors(parsed.errors), payeesLinked: linked.itemsLinked, ...(pipeline ? { pipeline } : {}) },
    };
  }

  const parsed = parseCsv(req.csv, req.mapping, ClearRowSchema, { refine: clearPlausibility(today) });
  const failed = failure(parsed);
  if (failed) return failed;
  if (req.preview) return previewOf(parsed);
  const summary = await insertClearRows(db, req.companyId, parsed.rows, { audit: importAudit(req) });
  return { status: 200, body: { ...summary, ...rowErrors(parsed.errors) } };
}
