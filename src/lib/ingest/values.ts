/** Scalar parsers for CSV cells. Money is integer cents; dates are 'YYYY-MM-DD'. */

export type DateFormat = "auto" | "YYYY-MM-DD" | "MM/DD/YYYY" | "M/D/YY";

export const DATE_FORMATS: readonly DateFormat[] = ["auto", "YYYY-MM-DD", "MM/DD/YYYY", "M/D/YY"];

const AMOUNT_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "$1,234.56" -> 123456, "(12.00)" -> -1200, "1234.5" -> 123450, "-5" -> -500. Throws on junk. */
export function parseAmountToCents(raw: string): number {
  let s = raw.trim().replace(/\s+/g, "");
  if (s === "") throw new Error("amount is empty");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  s = s.replace(/^\$/, "").replace(/^USD/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new Error(`cannot parse amount "${raw}"`);
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) throw new Error(`amount "${raw}" is too large`);
  return negative ? -cents : cents;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function build(y: number, m: number, d: number, raw: string): string {
  if (!isRealDate(y, m, d)) throw new Error(`"${raw}" is not a real calendar date`);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Two-digit years: 00-69 -> 2000s, 70-99 -> 1900s. */
function expandYear(yy: number): number {
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

export function parseDate(raw: string, format: DateFormat = "auto"): string {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us4 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const us2 = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (format === "YYYY-MM-DD" || format === "auto") {
    if (iso) return build(+iso[1]!, +iso[2]!, +iso[3]!, raw);
    if (format === "YYYY-MM-DD") throw new Error(`"${raw}" does not match YYYY-MM-DD`);
  }
  if (format === "MM/DD/YYYY" || format === "auto") {
    if (us4) return build(+us4[3]!, +us4[1]!, +us4[2]!, raw);
    if (format === "MM/DD/YYYY") throw new Error(`"${raw}" does not match MM/DD/YYYY`);
  }
  if (format === "M/D/YY" || format === "auto") {
    if (us2) return build(expandYear(+us2[3]!), +us2[1]!, +us2[2]!, raw);
    if (format === "M/D/YY") throw new Error(`"${raw}" does not match M/D/YY`);
  }
  throw new Error(`cannot parse date "${raw}"`);
}

const TRUE_VALUES = new Set(["true", "t", "yes", "y", "1", "void", "voided", "x"]);
const FALSE_VALUES = new Set(["false", "f", "no", "n", "0", ""]);

export function parseBoolean(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(s)) return true;
  if (FALSE_VALUES.has(s)) return false;
  throw new Error(`cannot parse boolean "${raw}"`);
}
