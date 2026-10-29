/**
 * Parse a NAUPA II fixed-width file back into structured records, using the same layout
 * table the writer uses (layout.ts). Tolerant: it never throws on malformed input, it reports
 * what it can read; validate.ts is responsible for judging it.
 */

import { compactToIso, decodeRecord, layoutForTrCode, RECORD_SEPARATOR, type RecordKind } from "./layout";

export interface NaupaRecord {
  type: RecordKind | "unknown";
  trCode: string;
  /** Decoded field values by spec field name (alpha right-trimmed, numeric/date as raw digits). */
  fields: Record<string, string>;
  /** The record exactly as it appears in the file. */
  line: string;
}

export interface ParsedHolder {
  name: string;
  taxId: string;
  taxIdExt: string;
  reportYear: string;
  /** A = advertising, R = remittance, T = test. */
  reportType: string;
  reportNumber: string;
  state: string;
  incorporatedState: string;
  contactName: string;
}

export interface ParsedProperty {
  sequence: number;
  ownerName: string;
  ownerCity: string;
  ownerState: string;
  ownerZip: string;
  /** ISO date, or null when blank/invalid. */
  lastActivityDate: string | null;
  propertyType: string;
  amountReportedCents: number;
  deductionCents: number;
  amountAdvertisedCents: number;
  amountRemittedCents: number;
  checkNumber: string;
  description: string;
  relationshipCode: string;
  ownerTypeCode: string;
  isAggregate: boolean;
}

export interface ParsedSummary {
  recordCount: number;
  propertyCount: number;
  amountReportedCents: number;
  deductionCents: number;
  amountAdvertisedCents: number;
  additionCents: number;
  deletionCents: number;
  amountRemittedCents: number;
  negativeReport: boolean;
  softwareVersion: string;
  creator: string;
}

export interface ParsedReport {
  records: NaupaRecord[];
  lineCount: number;
  holder: ParsedHolder | null;
  properties: ParsedProperty[];
  summary: ParsedSummary | null;
}

const get = (f: Record<string, string>, k: string): string => f[k] ?? "";
const int = (s: string): number => (/^\d+$/.test(s) ? Number(s) : Number.NaN);

/** Split a file into record lines. One trailing separator is allowed. Does not accept bare LF as a separator. */
export function splitRecords(file: string): string[] {
  if (file === "") return [];
  const lines = file.split(RECORD_SEPARATOR);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function parseRecord(line: string): NaupaRecord {
  const trCode = line.slice(0, 1);
  const layout = layoutForTrCode(trCode);
  if (!layout) return { type: "unknown", trCode, fields: {}, line };
  return { type: layout.kind, trCode, fields: decodeRecord(layout, line), line };
}

export function parseNaupaReport(file: string): ParsedReport {
  const lines = splitRecords(file);
  const records = lines.map(parseRecord);

  const h = records.find((r) => r.type === "holder")?.fields;
  const holder: ParsedHolder | null = h
    ? {
        name: get(h, "HOLDER-NAME"),
        taxId: get(h, "HOLDER-TAXID"),
        taxIdExt: get(h, "HOLDER-TAXID-EXT"),
        reportYear: get(h, "HOLDER-RPT-YEAR"),
        reportType: get(h, "HOLDER-RPT-TYPE"),
        reportNumber: get(h, "HOLDER-RPT-NUMBER"),
        state: get(h, "HOLDER-STATE"),
        incorporatedState: get(h, "HOLDER-INCORPORATED-STATE"),
        contactName: get(h, "HOLDER-CONTACT1-NAME"),
      }
    : null;

  const properties: ParsedProperty[] = records
    .filter((r) => r.type === "property")
    .map(({ fields: p }) => ({
      sequence: int(get(p, "PROP-SEQUENCE-NUMBER")),
      ownerName: [get(p, "PROP-OWNER-NAME-FIRST"), get(p, "PROP-OWNER-NAME-LAST")].filter(Boolean).join(" "),
      ownerCity: get(p, "PROP-OWNER-CITY"),
      ownerState: get(p, "PROP-OWNER-STATE"),
      ownerZip: get(p, "PROP-OWNER-ZIP"),
      lastActivityDate: compactToIso(get(p, "PROP-ST-TRANS-DATE")),
      propertyType: get(p, "PROP-PROPERTY-TYPE"),
      amountReportedCents: int(get(p, "PROP-AMOUNT-REPORTED")),
      deductionCents: int(get(p, "PROP-DEDUCTION-AMOUNT")),
      amountAdvertisedCents: int(get(p, "PROP-AMOUNT-ADVERTISED")),
      amountRemittedCents: int(get(p, "PROP-AMOUNT-REMITTED")),
      checkNumber: get(p, "PROP-CHECK-NUMBER"),
      description: get(p, "PROP-DESCRIPTION"),
      relationshipCode: get(p, "PROP-RELATIONSHIP-CODE"),
      ownerTypeCode: get(p, "PROP-OWNER-TYPE-CODE"),
      isAggregate: get(p, "PROP-OWNER-TYPE-CODE") === "AP",
    }));

  const s = [...records].reverse().find((r) => r.type === "summary")?.fields;
  const summary: ParsedSummary | null = s
    ? {
        recordCount: int(get(s, "SUMM-NBR-OF-RECORDS")),
        propertyCount: int(get(s, "SUMM-NBR-OF-PROPERTIES")),
        amountReportedCents: int(get(s, "SUMM-AMOUNT-REPORTED")),
        deductionCents: int(get(s, "SUMM-DEDUCTION-AMOUNT")),
        amountAdvertisedCents: int(get(s, "SUMM-AMOUNT-ADVERTISED")),
        additionCents: int(get(s, "SUMM-ADDITION-AMOUNT")),
        deletionCents: int(get(s, "SUMM-DELETION-AMOUNT")),
        amountRemittedCents: int(get(s, "SUMM-AMOUNT-REMITTED")),
        negativeReport: get(s, "SUMM-NEGATIVE-REPORT") === "Y",
        softwareVersion: get(s, "SUMM-SOFTWARE-VERSION"),
        creator: get(s, "SUMM-CREATOR"),
      }
    : null;

  return { records, lineCount: lines.length, holder, properties, summary };
}
