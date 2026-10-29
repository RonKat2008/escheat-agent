/**
 * Declarative NAUPA II record layouts, transcribed from docs/naupa-format.md, which was
 * extracted from the official spec "NAUPA Standard Electronic File Format" (1.29.25),
 * https://unclaimed.org/wp-content/uploads/NAUPAIIStandardElectronicFileFormat-1.29.25.pdf
 *
 * Every record is 625 bytes (spec p.3): byte 1 is TR-CODE, bytes 2-625 are the fields.
 * Alpha ("C") fields: left-justified, space filled. Numeric ("N") fields: right-justified,
 * zero filled, decimal points implied (spec p.2). Dates are CCYY+MM+DD, three contiguous numeric
 * subfields, modelled here as one 8-byte `date` field (spec p.8).
 */

export const RECORD_LENGTH = 625;
export const RECORD_SEPARATOR = "\r\n"; // spec p.2: CR/LF

export type FieldType = "alpha" | "numeric" | "date";
/** M = mandatory, R = required if known, O = optional (spec p.3). */
export type FieldClass = "M" | "R" | "O";
export type RecordKind = "holder" | "property" | "propadd" | "summary";

export interface FieldDef {
  name: string;
  /** 1-based start byte. */
  start: number;
  length: number;
  type: FieldType;
  cls: FieldClass;
  /** Allowed decoded values ("" = blank). */
  allowed?: readonly string[];
  /** Constant value (TR-CODE etc.). */
  fixed?: string;
  /** Treat an "R" field as a hard error when blank (stricter than the spec; see comments). */
  enforce?: boolean;
  /** Names-style charset: A-Z 0-9 space & only (spec p.19 HOLDER-NAME). */
  nameCharset?: boolean;
}

export interface RecordLayout {
  kind: RecordKind;
  trCode: string;
  /** Spec citation. */
  spec: string;
  fields: readonly FieldDef[];
}

type Extra = Partial<Pick<FieldDef, "allowed" | "fixed" | "enforce" | "nameCharset">>;
const A = "alpha" as const;
const N = "numeric" as const;
const D = "date" as const;
const f = (name: string, start: number, length: number, type: FieldType, cls: FieldClass, extra: Extra = {}): FieldDef => ({
  name,
  start,
  length,
  type,
  cls,
  ...extra,
});

/* ----------------------------------------------------------------------------------------------
 * HOLDER, TR-CODE 1: spec pp.19-20.
 * -------------------------------------------------------------------------------------------- */
export const HOLDER_LAYOUT: RecordLayout = {
  kind: "holder",
  trCode: "1",
  spec: "NAUPA II spec pp.19-20 (HOLDER record, TR-CODE 1)",
  fields: [
    f("TR-CODE", 1, 1, N, "M", { fixed: "1" }),
    f("HOLDER-TAXID", 2, 9, N, "M"),
    f("HOLDER-TAXID-EXT", 11, 4, N, "R"),
    f("HOLDER-RPT-YEAR", 15, 4, A, "M"),
    f("HOLDER-RPT-TYPE", 19, 1, A, "M", { allowed: ["A", "R", "T"] }),
    f("HOLDER-RPT-NUMBER", 20, 2, A, "M"),
    f("HOLDER-RPT-FORMAT", 22, 1, A, "M", { allowed: ["R"] }),
    f("HOLDER-SIC-CODE", 23, 4, N, "R"),
    f("HOLDER-INCORPORATED-STATE", 27, 2, A, "R"),
    f("HOLDER-INC-DATE", 29, 8, D, "R"),
    f("HOLDER-NAME", 37, 40, A, "M", { nameCharset: true }),
    f("HOLDER-CITY", 77, 30, A, "R"),
    f("HOLDER-COUNTY", 107, 20, A, "R"),
    f("HOLDER-STATE", 127, 2, A, "R"),
    f("HOLDER-CONTACT1-NAME", 129, 40, A, "M"),
    f("HOLDER-CONTACT1-ADDR1", 169, 30, A, "M"),
    // Spec table lists ADDR1/2/3 all as M; lines 2-3 are treated as optional here (a one-line address cannot fill them).
    f("HOLDER-CONTACT1-ADDR2", 199, 30, A, "O"),
    f("HOLDER-CONTACT1-ADDR3", 229, 30, A, "O"),
    f("HOLDER-CONTACT1-CITY", 259, 30, A, "M"),
    f("HOLDER-CONTACT1-STATE", 289, 2, A, "M"),
    f("HOLDER-CONTACT1-ZIP", 291, 9, A, "M"),
    f("HOLDER-CONTACT1-COUNTRY", 300, 3, A, "M"),
    f("HOLDER-CONTACT1-TEL-AC", 303, 3, N, "M"),
    f("HOLDER-CONTACT1-TEL-NBR", 306, 7, N, "M"),
    f("HOLDER-CONTACT1-TEL-EXT", 313, 4, A, "O"),
    f("HOLDER-CONTACT1-EMAIL", 317, 50, A, "O"),
    f("HOLDER-CONTACT2-NAME", 367, 40, A, "O"),
    f("HOLDER-CONTACT2-ADDR1", 407, 30, A, "O"),
    f("HOLDER-CONTACT2-ADDR2", 437, 30, A, "O"),
    f("HOLDER-CONTACT2-ADDR3", 467, 30, A, "O"),
    f("HOLDER-CONTACT2-CITY", 497, 30, A, "O"),
    f("HOLDER-CONTACT2-STATE", 527, 2, A, "O"),
    f("HOLDER-CONTACT2-ZIP", 529, 9, A, "O"),
    f("HOLDER-CONTACT2-COUNTRY", 538, 3, A, "O"),
    f("HOLDER-CONTACT2-TEL-AC", 541, 3, N, "O"),
    f("HOLDER-CONTACT2-TEL-NBR", 544, 7, N, "O"),
    f("HOLDER-CONTACT2-TEL-EXT", 551, 4, A, "O"),
    f("HOLDER-CONTACT2-EMAIL", 555, 50, A, "O"),
    f("HOLDER-FAX-AC", 605, 3, N, "O"),
    f("HOLDER-FAX-NBR", 608, 7, N, "O"),
    f("HOLDER-NAICS-CODE", 615, 6, A, "R"),
    f("FILLER", 621, 5, A, "M"),
  ],
};

/* ----------------------------------------------------------------------------------------------
 * PROPERTY, TR-CODE 2: spec pp.20-22. Deduction/addition/deletion type lists: pp.14-15;
 * owner-type codes: p.18.
 * -------------------------------------------------------------------------------------------- */
export const PROPERTY_LAYOUT: RecordLayout = {
  kind: "property",
  trCode: "2",
  spec: "NAUPA II spec pp.20-22 (PROPERTY record, TR-CODE 2)",
  fields: [
    f("TR-CODE", 1, 1, N, "M", { fixed: "2" }),
    f("PROP-SEQUENCE-NUMBER", 2, 6, N, "M"),
    f("PROP-OWNER-TYPE", 8, 1, A, "M", { fixed: "P" }),
    f("PROP-NAME-ID", 9, 1, A, "M", { allowed: ["C", ""] }),
    f("PROP-OWNER-NAME-LAST", 10, 40, A, "M"),
    f("PROP-OWNER-NAME-FIRST", 50, 30, A, "R"),
    f("PROP-OWNER-NAME-MIDDLE", 80, 10, A, "R"),
    f("PROP-OWNER-NAME-PREFIX", 90, 10, A, "R"),
    f("PROP-OWNER-NAME-SUFFIX", 100, 10, A, "R"),
    f("PROP-OWNER-NAME-TITLE", 110, 6, A, "R"),
    f("PROP-OWNER-ADDRESS1", 116, 30, A, "R"),
    f("PROP-OWNER-ADDRESS2", 146, 30, A, "R"),
    f("PROP-OWNER-ADDRESS3", 176, 30, A, "R"),
    f("PROP-OWNER-CITY", 206, 30, A, "R"),
    f("PROP-OWNER-COUNTY", 236, 20, A, "O"),
    f("PROP-OWNER-STATE", 256, 2, A, "R"),
    f("PROP-OWNER-ZIP", 258, 9, A, "R"),
    f("PROP-OWNER-COUNTRY", 267, 3, A, "R"),
    f("PROP-OWNER-TAXID", 270, 9, N, "R"),
    f("PROP-OWNER-TAXID-EXT", 279, 2, A, "O"),
    f("PROP-OWNER-DOB", 281, 8, D, "O"),
    // Spec class R. Stricter here: TX rejects a report without last-contact date (docs/naupa-format.md).
    f("PROP-ST-TRANS-DATE", 289, 8, D, "R", { enforce: true }),
    f("PROP-EN-TRANS-DATE", 297, 8, D, "O"),
    // Spec class R. Stricter here: a property record without a code cannot be filed.
    f("PROP-PROPERTY-TYPE", 305, 4, A, "R", { enforce: true }),
    f("PROP-AMOUNT-REPORTED", 309, 10, N, "M"),
    f("PROP-DEDUCTION-TYPE", 319, 2, A, "M", { allowed: ["", "DW", "IW", "MC", "SW", "TW", "ZZ"] }),
    f("PROP-DEDUCTION-AMOUNT", 321, 10, N, "M"),
    f("PROP-AMOUNT-ADVERTISED", 331, 10, N, "M"),
    f("PROP-ADDITION-TYPE", 341, 2, A, "R", { allowed: ["", "DR", "DV", "IN", "ME", "SP", "ZZ"] }),
    f("PROP-ADDITION-AMOUNT", 343, 10, N, "M"),
    f("PROP-DELETION-TYPE", 353, 2, A, "R", { allowed: ["", "ER", "RO", "RS", "ZZ"] }),
    f("PROP-DELETION-AMOUNT", 355, 10, N, "M"),
    f("PROP-AMOUNT-REMITTED", 365, 10, N, "M"),
    f("PROP-INTEREST-FLAG", 375, 1, A, "O", { allowed: ["", "Y", "N"] }),
    f("PROP-INTEREST-RATE", 376, 7, N, "O"),
    f("STOCK-ISSUE-NAME", 383, 25, A, "O"),
    f("STOCK-CUSIP", 408, 9, A, "O"),
    f("STOCK-NUMBER-OF-SHARES", 417, 12, N, "O"),
    f("STOCK-ADD-SHARES", 429, 12, N, "O"),
    f("STOCK-DEL-SHARES", 441, 12, N, "O"),
    f("STOCK-REM-SHARES", 453, 12, N, "O"),
    f("UNEXCHANGED-ISSUE-NAME", 465, 25, A, "O"),
    f("UNEXCHANGED-CUSIP", 490, 9, A, "O"),
    f("UNEXCHANGED-SHARES", 499, 12, N, "O"),
    f("PROP-ACCT-NUMBER", 511, 20, A, "O"),
    f("PROP-CHECK-NUMBER", 531, 20, A, "O"),
    f("PROP-DESCRIPTION", 551, 50, A, "O"),
    f("PROP-RELATIONSHIP-CODE", 601, 2, A, "M"),
    f("PROP-OWNER-TYPE-CODE", 603, 2, A, "M", { allowed: ["AP", "OT", "UN"] }),
    f("FILLER", 605, 21, A, "M"),
  ],
};

/**
 * PROPADD, TR-CODE 3 (spec p.22): additional owner. NOT generated by this implementation; only the
 * record length and TR-CODE are checked. The spec table has position errata (docs/naupa-format.md).
 */
export const PROPADD_LAYOUT: RecordLayout = {
  kind: "propadd",
  trCode: "3",
  spec: "NAUPA II spec p.22 (PROPADD record, TR-CODE 3), fields not modelled",
  fields: [f("TR-CODE", 1, 1, N, "M", { fixed: "3" }), f("BODY", 2, 624, A, "O")],
};

/* ----------------------------------------------------------------------------------------------
 * SUMINFO, TR-CODE 9: spec p.24 (definitions pp.13-14). The p.24 table stops at field 17; the
 * trailing FILLER (253-625) is inferred from the 625-byte record length (docs/naupa-format.md).
 * -------------------------------------------------------------------------------------------- */
export const SUMMARY_LAYOUT: RecordLayout = {
  kind: "summary",
  trCode: "9",
  spec: "NAUPA II spec p.24 (SUMINFO record, TR-CODE 9; FILLER inferred)",
  fields: [
    f("TR-CODE", 1, 1, N, "M", { fixed: "9" }),
    f("SUMM-NBR-OF-RECORDS", 2, 6, N, "M"),
    f("SUMM-NBR-OF-PROPERTIES", 8, 6, N, "M"),
    f("SUMM-AMOUNT-REPORTED", 14, 12, N, "M"),
    f("SUMM-DEDUCTION-AMOUNT", 26, 12, N, "M"),
    f("SUMM-AMOUNT-ADVERTISED", 38, 12, N, "M"),
    f("SUMM-ADDITION-AMOUNT", 50, 12, N, "M"),
    f("SUMM-DELETION-AMOUNT", 62, 12, N, "M"),
    f("SUMM-AMOUNT-REMITTED", 74, 12, N, "M"),
    f("SUMM-NBR-OF-SHARES", 86, 14, N, "M"),
    f("SUMM-SHARES-ADD", 100, 14, N, "M"),
    f("SUMM-SHARES-DEL", 114, 14, N, "M"),
    f("SUMM-SHARES-REMITTED", 128, 14, N, "M"),
    f("SUMM-NEGATIVE-REPORT", 142, 1, A, "O", { allowed: ["", "Y"] }),
    f("SUMM-SOFTWARE-VERSION", 143, 20, A, "M"),
    f("SUMM-CREATOR", 163, 20, A, "M"),
    f("SUMM-CREATOR-CONTACT", 183, 70, A, "M"),
    f("FILLER", 253, 373, A, "M"),
  ],
};

export const LAYOUTS: Record<RecordKind, RecordLayout> = {
  holder: HOLDER_LAYOUT,
  property: PROPERTY_LAYOUT,
  propadd: PROPADD_LAYOUT,
  summary: SUMMARY_LAYOUT,
};

export function layoutForTrCode(code: string): RecordLayout | null {
  return Object.values(LAYOUTS).find((l) => l.trCode === code) ?? null;
}

/* ----------------------------------------------------------------------------------------------
 * Property type codes: spec p.17. Aggregate codes (CK99, MS99) are in the same list.
 * -------------------------------------------------------------------------------------------- */
export const SPEC_AGGREGATE_CODES: Readonly<Record<string, string>> = { CK: "CK99", MS: "MS99" };

/** Aggregate code for a given NAUPA code by its 2-letter family, or null if the family has no spec aggregate code. */
export function aggregateCodeFor(code: string): string | null {
  return SPEC_AGGREGATE_CODES[code.slice(0, 2)] ?? null;
}

/* ----------------------------------------------------------------------------------------------
 * Encoding helpers
 * -------------------------------------------------------------------------------------------- */

/** Uppercase, fold accents (NFD, drop marks), drop anything that is not printable ASCII. */
export function sanitizeAscii(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Holder/name charset: A-Z, 0-9, space, & only (spec p.19). */
export function sanitizeName(input: string): string {
  return sanitizeAscii(input)
    .replace(/[^A-Z0-9 &]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class EncodeError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "EncodeError";
  }
}

export type FieldValue = string | number | null | undefined;
export interface EncodeResult {
  line: string;
  /** Decoded field values exactly as they appear in the line. */
  fields: Record<string, string>;
  /** Fields whose alpha value was cut to fit. */
  truncated: string[];
}

/** 'YYYY-MM-DD' to 'YYYYMMDD'. Throws EncodeError if not a real calendar date. */
export function isoToCompact(field: string, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !isRealDate(`${m[1]}${m[2]}${m[3]}`)) throw new EncodeError(field, `invalid date ${JSON.stringify(iso)}`);
  return `${m[1]}${m[2]}${m[3]}`;
}

export function isRealDate(compact: string): boolean {
  if (!/^\d{8}$/.test(compact)) return false;
  const y = Number(compact.slice(0, 4));
  const mo = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  if (y < 1000 || mo < 1 || mo > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= dim;
}

export function encodeField(def: FieldDef, value: FieldValue): { text: string; truncated: boolean } {
  const v = def.fixed !== undefined ? def.fixed : value;
  if (def.type === "alpha") {
    const clean = def.nameCharset ? sanitizeName(String(v ?? "")) : sanitizeAscii(String(v ?? ""));
    const cut = clean.slice(0, def.length);
    return { text: cut.padEnd(def.length, " "), truncated: clean.length > def.length };
  }
  if (def.type === "date") {
    if (v === null || v === undefined || v === "") return { text: "0".repeat(def.length), truncated: false };
    const s = String(v);
    const compact = /^\d{4}-\d{2}-\d{2}$/.test(s) ? isoToCompact(def.name, s) : s;
    if (!isRealDate(compact)) throw new EncodeError(def.name, `invalid date ${JSON.stringify(s)}`);
    return { text: compact, truncated: false };
  }
  // numeric
  const s = v === null || v === undefined || v === "" ? "0" : String(v);
  if (!/^\d+$/.test(s)) throw new EncodeError(def.name, `numeric field needs digits only, got ${JSON.stringify(s)}`);
  if (s.length > def.length) throw new EncodeError(def.name, `value ${s} exceeds ${def.length} digits`);
  return { text: s.padStart(def.length, "0"), truncated: false };
}

export function decodeField(def: FieldDef, raw: string): string {
  return def.type === "alpha" ? raw.replace(/ +$/, "") : raw;
}

export function encodeRecord(layout: RecordLayout, values: Record<string, FieldValue>): EncodeResult {
  const chars: string[] = new Array<string>(RECORD_LENGTH).fill(" ");
  const fields: Record<string, string> = {};
  const truncated: string[] = [];
  for (const def of layout.fields) {
    const { text, truncated: cut } = encodeField(def, values[def.name]);
    if (cut) truncated.push(def.name);
    for (let i = 0; i < def.length; i++) chars[def.start - 1 + i] = text.charAt(i);
    fields[def.name] = decodeField(def, text);
  }
  return { line: chars.join(""), fields, truncated };
}

/** Decode a line using a layout. Short lines are read as far as they go (the validator reports the length). */
export function decodeRecord(layout: RecordLayout, line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of layout.fields) out[def.name] = decodeField(def, line.slice(def.start - 1, def.start - 1 + def.length));
  return out;
}

/** Compact CCYYMMDD to ISO, or null for blank / all-zero / invalid. */
export function compactToIso(compact: string): string | null {
  if (!isRealDate(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}
