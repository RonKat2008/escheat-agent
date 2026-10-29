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
  /** 1-based data row (header excluded, blank lines not counted). 0 = file-level. */
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
  headers: string[];
}

function readRecords(text: string, to?: number): string[][] {
  return parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    ...(to ? { to } : {}),
  }) as string[][];
}

/** Header names as they appear in the file. Empty when unreadable. */
export function readHeaders(text: string): string[] {
  try {
    return (readRecords(text, 1)[0] ?? []).map((h) => h.trim());
  } catch {
    return [];
  }
}

function emptyResult<T>(headers: string[], headerErrors: string[]): ParseResult<T> {
  return { rows: [], raws: [], errors: [], headerErrors, headers };
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
export function parseCsv<T>(text: string, mapping: ColumnMapping, schema: z.ZodType<T>): ParseResult<T> {
  let records: string[][];
  try {
    records = readRecords(text);
  } catch (err) {
    return emptyResult([], [`Could not read CSV: ${err instanceof Error ? err.message : String(err)}`]);
  }
  if (records.length === 0) return emptyResult([], ["CSV is empty"]);

  const headers = records[0]!;
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
  records.slice(1).forEach((cells, i) => {
    const row = i + 1;
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
    result.rows.push(parsed.data);
    result.raws.push(raw);
  });
  return result;
}
