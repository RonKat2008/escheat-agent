import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { companies } from "@/db/schema";
import { parseCsv, readHeaders, type ParseError } from "./csv";
import { ColumnMappingSchema, suggestMapping, type ColumnMapping } from "./mapping";
import { insertClearRows, insertLedgerRows, resolvePayees } from "./persist";
import { ClearRowSchema, INGEST_KINDS, LedgerRowSchema } from "./schemas";

export const MAX_CSV_CHARS = 10_000_000;

export const IngestRequestSchema = z.object({
  kind: z.enum(INGEST_KINDS),
  csv: z.string().min(1, "csv is empty").max(MAX_CSV_CHARS, "csv is too large"),
  mapping: ColumnMappingSchema.optional(),
  companyId: z.uuid(),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export type IngestOutcome =
  | { status: 200; body: { needsMapping: true; suggested: ColumnMapping; headers: string[] } }
  | { status: 200; body: { inserted: number; skipped: number; errors: ParseError[]; payeesLinked?: number } }
  | { status: 404 | 422; body: { error: string; headerErrors?: string[]; errors?: ParseError[] } };

/** Core of POST /api/ingest, separated from the route so it is testable against any Db. */
export async function ingestCsv(db: Db, req: IngestRequest): Promise<IngestOutcome> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, req.companyId));
  if (!company) return { status: 404, body: { error: "Company not found" } };

  if (!req.mapping) {
    const headers = readHeaders(req.csv);
    if (headers.length === 0) return { status: 422, body: { error: "Could not read a header row from the CSV" } };
    return { status: 200, body: { needsMapping: true, suggested: suggestMapping(headers, req.kind), headers } };
  }

  if (req.kind === "ledger") {
    const parsed = parseCsv(req.csv, req.mapping, LedgerRowSchema);
    if (parsed.headerErrors.length > 0) {
      return { status: 422, body: { error: "Column mapping does not fit this CSV", headerErrors: parsed.headerErrors } };
    }
    if (parsed.rows.length === 0 && parsed.errors.length > 0) {
      return { status: 422, body: { error: "No valid rows", errors: parsed.errors } };
    }
    const summary = await insertLedgerRows(db, req.companyId, parsed.rows, parsed.raws);
    const linked = await resolvePayees(db, req.companyId);
    return { status: 200, body: { ...summary, errors: parsed.errors, payeesLinked: linked.itemsLinked } };
  }

  const parsed = parseCsv(req.csv, req.mapping, ClearRowSchema);
  if (parsed.headerErrors.length > 0) {
    return { status: 422, body: { error: "Column mapping does not fit this CSV", headerErrors: parsed.headerErrors } };
  }
  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    return { status: 422, body: { error: "No valid rows", errors: parsed.errors } };
  }
  const summary = await insertClearRows(db, req.companyId, parsed.rows);
  return { status: 200, body: { ...summary, errors: parsed.errors } };
}
