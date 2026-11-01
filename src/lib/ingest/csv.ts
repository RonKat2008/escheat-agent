import { parse } from "csv-parse/sync";
import type { z } from "zod";
import { normHeader, type ColumnMapping } from "./mapping";
import { parseAmountToCents, parseBoolean, parseDate } from "./values";

export {
  ColumnMappingSchema,
  suggestMapping,
  syntheticClearsMapping,
  syntheticLedgerMapping,
  requiredFields,
  type ColumnMapping,
} from "./mapping";
export { parseAmountToCents, parseDate } from "./values";

export interface ParseError {
  /** Spreadsheet line number where the record starts (header = line 1, blank lines counted). 0 = file-level. */
  row: number;
  field?: string;
  message: string;
  raw: Record<string, string> | string[] | null;
}

export interface ParseResult<T> {
  rows: T[];
  /** Original cells for each entry of `rows` (same index), keyed by source header. */
  raws: Record<string, string>[];
  errors: ParseError[];
  /** Up-front problems (unreadable CSV, mapped headers that don't exist). Rows are empty if non-empty. */
  headerErrors: string[];
  /** The file is not well-formed CSV (e.g. unclosed quote). Distinct from mapping problems. Rows are empty if set. */
  parseError?: CsvParseFailure;
  headers: string[];
}

export interface CsvParseFailure {
  line: number;
  message: string;
}

export interface RowIssue {
  field?: string;
  message: string;
}

export interface ParseOptions<T> {
  /** Extra per-row checks (implausible values) run after schema validation; any issue rejects the row. */
  refine?: (row: T) => RowIssue[];
}

interface Rec {
  cells: string[];
  /** Spreadsheet line where the record starts. */
  line: number;
}

function stripOuterNewlines(raw: string): string {
  return raw.replace(/^(\r?\n)+/, "").replace(/\r?\n$/, "");
}

/** Line where the quote that never closed was opened (last quote that left the scanner inside a quoted field). */
function findUnclosedQuoteLine(text: string): number {
  let line = 1;
  let inQuote = false;
  let openedAt = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") line++;
    else if (c === '"') {
      if (inQuote && text[i + 1] === '"') i++;
      else {
        inQuote = !inQuote;
        if (inQuote) openedAt = line;
      }
    }
  }
  return openedAt;
}

const PARSE_MESSAGES: Record<string, string> = {
  CSV_QUOTE_NOT_CLOSED: "unclosed quote",
  INVALID_OPENING_QUOTE: "unexpected quote inside an unquoted field",
  CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE: "unexpected character after a closing quote",
};

function toFailure(err: unknown, text: string): CsvParseFailure {
  const e = err as { code?: string; lines?: number; message?: string };
  const message = (e.code && PARSE_MESSAGES[e.code]) ?? (e.message ?? String(err)).replace(/^[A-Z][A-Za-z ]+: /, "");
  const line = e.code === "CSV_QUOTE_NOT_CLOSED" ? findUnclosedQuoteLine(text) : (e.lines ?? 1);
  return { line, message };
}

function readRecords(text: string, to?: number): Rec[] {
  const out = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    info: true,
    raw: true,
    ...(to ? { to } : {}),
  }) as unknown as { record: string[]; info: { lines: number; raw: string } }[];
  return out.map(({ record, info }) => ({
    cells: record,
    line: info.lines - (stripOuterNewlines(info.raw).match(/\n/g)?.length ?? 0),
  }));
}

/** Header names as they appear in the file. Empty when unreadable. */
export function readHeaders(text: string): string[] {
  try {
    return (readRecords(text, 1)[0]?.cells ?? []).map((h) => h.trim());
  } catch {
    return [];
  }
}

/** Is the whole file well-formed CSV? Returns the failure with its line, or null. */
export function checkCsvSyntax(text: string): CsvParseFailure | null {
  try {
    readRecords(text);
    return null;
  } catch (err) {
    return toFailure(err, text);
  }
}

function emptyResult<T>(headers: string[], headerErrors: string[], parseError?: CsvParseFailure): ParseResult<T> {
  return { rows: [], raws: [], errors: [], headerErrors, headers, ...(parseError ? { parseError } : {}) };
}

function convert(mapping: ColumnMapping, field: string, cell: string): unknown {
  const custom = mapping.transforms?.[field];
  if (custom) return custom(cell);
  switch (mapping.types?.[field] ?? "string") {
    case "amount":
      return parseAmountToCents(cell);
    case "date":
      return parseDate(cell, mapping.dateFormat ?? "auto");
    case "boolean":
      return parseBoolean(cell);
    default:
      return cell;
  }
}

/**
 * Parse CSV text into validated rows. Bad rows are reported in `errors` (with 1-based
 * row numbers), never silently dropped. Unknown/missing mapped headers are reported up front.
 */
export function parseCsv<T>(
  text: string,
  mapping: ColumnMapping,
  schema: z.ZodType<T>,
  opts: ParseOptions<T> = {},
): ParseResult<T> {
  let records: Rec[];
  try {
    records = readRecords(text);
  } catch (err) {
    return emptyResult([], [], toFailure(err, text));
  }
  if (records.length === 0) return emptyResult([], ["CSV is empty"]);

  const headers = records[0]!.cells;
  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normHeader(h);
    if (!headerIndex.has(key)) headerIndex.set(key, i);
  });

  const required = new Set(mapping.required ?? Object.keys(mapping.columns));
  const fieldIdx = new Map<string, number>();
  const headerErrors: string[] = [];
  for (const [field, header] of Object.entries(mapping.columns)) {
    const idx = headerIndex.get(normHeader(header));
    if (idx === undefined) {
      if (required.has(field)) headerErrors.push(`Missing column "${header}" (for ${field})`);
    } else {
      fieldIdx.set(field, idx);
    }
  }
  for (const field of required) {
    if (!(field in mapping.columns)) headerErrors.push(`No column mapped for required field ${field}`);
  }
  if (headerErrors.length > 0) return emptyResult(headers, headerErrors);

  const result: ParseResult<T> = { rows: [], raws: [], errors: [], headerErrors: [], headers };
  records.slice(1).forEach(({ cells, line }) => {
    const row = line;
    const raw: Record<string, string> = {};
    headers.forEach((h, c) => {
      raw[h] = cells[c] ?? "";
    });
    if (cells.length > headers.length) {
      result.errors.push({
        row,
        message: `Row has ${cells.length} cells but the header has ${headers.length}`,
        raw: cells,
      });
      return;
    }

    const candidate: Record<string, unknown> = {};
    let failed = false;
    for (const [field, idx] of fieldIdx) {
      const cell = (cells[idx] ?? "").trim();
      if (cell === "") continue; // empty -> undefined; the schema decides if that is allowed
      try {
        candidate[field] = convert(mapping, field, cell);
      } catch (err) {
        failed = true;
        result.errors.push({ row, field, message: err instanceof Error ? err.message : String(err), raw });
      }
    }
    if (failed) return;

    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] !== undefined ? String(issue.path[0]) : undefined;
        const missing = field !== undefined && candidate[field] === undefined;
        result.errors.push({
          row,
          ...(field !== undefined ? { field } : {}),
          message: missing ? `${field} is required but empty` : issue.message,
          raw,
        });
      }
      return;
    }
    const issues = opts.refine?.(parsed.data) ?? [];
    if (issues.length > 0) {
      for (const issue of issues) result.errors.push({ row, ...(issue.field ? { field: issue.field } : {}), message: issue.message, raw });
      return;
    }
    result.rows.push(parsed.data);
    result.raws.push(raw);
  });
  return result;
}
