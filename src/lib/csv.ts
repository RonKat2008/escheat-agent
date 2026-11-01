/**
 * Minimal RFC 4180 CSV writer with a spreadsheet formula-injection guard (OWASP CSV injection):
 * a cell whose first character is = + - @ (or tab / carriage return) is prefixed with an apostrophe so Excel and
 * Sheets treat it as text. Fields containing a comma, quote or line break are quoted, with quotes doubled.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/** Header plus rows, CRLF separated, trailing CRLF. */
export function toCsv(header: readonly string[], rows: Iterable<readonly unknown[]>): string {
  const lines = [csvRow(header)];
  for (const r of rows) lines.push(csvRow(r));
  return `${lines.join("\r\n")}\r\n`;
}
