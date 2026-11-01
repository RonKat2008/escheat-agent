import type { ParseError } from "./csv";

export const MAX_EXAMPLE_LINES = 5;

export interface ErrorGroup {
  field?: string;
  message: string;
  count: number;
  /** First few spreadsheet line numbers (header = line 1). */
  lines: number[];
}

/** Collapse identical row errors ("648 rows: unknown kind 'x'") into counted groups, biggest first. */
export function groupParseErrors(errors: readonly ParseError[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const key = `${e.field ?? ""}\u0000${e.message}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (g.lines.length < MAX_EXAMPLE_LINES) g.lines.push(e.row);
    } else {
      groups.set(key, { ...(e.field ? { field: e.field } : {}), message: e.message, count: 1, lines: [e.row] });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
