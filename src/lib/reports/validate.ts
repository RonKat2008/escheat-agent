/**
 * Independent validation of a NAUPA II file: re-parses the fixed-width text with the same layout table
 * the writer uses (layout.ts) and checks structure, field content, allowed codes and totals.
 */

import type { RuleFile } from "../../../rules/schema";
import { PROPERTY_TYPES } from "../../../rules/schema";
import {
  aggregateCodeFor,
  isRealDate,
  LAYOUTS,
  RECORD_LENGTH,
  type FieldDef,
} from "./layout";
import { parseRecord, splitRecords, type NaupaRecord } from "./parse";

export interface ValidationError {
  /** 1-based record number in the file; 0 for file-level problems. */
  record: number;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ExpectedReport {
  state: string;
  /** Sum of all item amounts the file is supposed to carry. */
  totalCents: number;
  /** Number of PROPERTY records expected (aggregate rows count as one). */
  propertyRecordCount?: number;
  byPropertyCode?: Readonly<Record<string, { count: number; cents: number }>>;
  /** Allowed property codes. If omitted they are derived from `rules`. */
  allowedPropertyCodes?: readonly string[];
  rules?: RuleFile;
  /** Whether this report stage remits funds: true => HOLDER-RPT-TYPE R and remitted == advertised; false => A and remitted 0. */
  includesRemittance?: boolean;
}

/** The synthetic placeholder holder TIN (never a real-looking TIN). */
export const SYNTHETIC_HOLDER_TAXID = "000000000";
export const SYNTHETIC_HOLDER_TAXID_EXT = "0001";

/** Codes a state's rule file maps to (non-null), plus the spec aggregate counterparts. */
export function allowedCodesFromRules(rules: RuleFile): string[] {
  const out = new Set<string>();
  for (const pt of PROPERTY_TYPES) {
    const code = rules.propertyTypes[pt]?.naupaCode.value;
    if (!code) continue;
    out.add(code);
    const agg = aggregateCodeFor(code);
    if (agg) out.add(agg);
  }
  return [...out];
}

const err = (record: number, field: string, message: string): ValidationError => ({ record, field, message, severity: "error" });
const warn = (record: number, field: string, message: string): ValidationError => ({ record, field, message, severity: "warning" });

function checkField(rec: NaupaRecord, recNo: number, def: FieldDef, out: ValidationError[], skipOwnerR: boolean): void {
  const raw = rec.line.slice(def.start - 1, def.start - 1 + def.length);
  const v = rec.fields[def.name] ?? "";
  const blank = def.type === "alpha" ? v === "" : /^0*$/.test(raw);

  if (def.type === "numeric" && !/^\d+$/.test(raw)) {
    out.push(err(recNo, def.name, `numeric field must be digits only, got ${JSON.stringify(raw)}`));
    return;
  }
  if (def.type === "date") {
    const unset = /^0{8}$/.test(raw);
    if (!unset && !isRealDate(raw)) {
      out.push(err(recNo, def.name, `invalid date ${JSON.stringify(raw)} (expected CCYYMMDD)`));
      return;
    }
  }
  if (def.fixed !== undefined && v !== def.fixed) {
    out.push(err(recNo, def.name, `must be ${JSON.stringify(def.fixed)}, got ${JSON.stringify(v)}`));
  }
  if (def.allowed && !def.allowed.includes(v)) {
    out.push(err(recNo, def.name, `value ${JSON.stringify(v)} not in allowed set [${def.allowed.map((a) => JSON.stringify(a)).join(", ")}]`));
  }
  if (def.nameCharset && /[^A-Z0-9 &]/.test(v)) {
    out.push(err(recNo, def.name, "name may contain only A-Z, 0-9, space and & (spec p.19)"));
  }
  const allowsBlank = def.allowed?.includes("") ?? false;
  if (blank && !allowsBlank && def.fixed === undefined) {
    // FILLER is "M" in the spec but is spaces by definition.
    if (def.name === "FILLER") return;
    // Numeric M fields are zero filled: a zero is a value, not a missing field.
    if (def.type === "numeric" && def.cls === "M") return;
    if (def.cls === "M") out.push(err(recNo, def.name, "mandatory field is blank"));
    else if (def.cls === "R" && !skipOwnerR) {
      out.push(def.enforce ? err(recNo, def.name, "required field is blank") : warn(recNo, def.name, "required-if-known field is blank"));
    }
  }
}

function amount(rec: NaupaRecord, name: string): number {
  const v = rec.fields[name];
  return /^\d+$/.test(v ?? "") ? Number(v) : Number.NaN;
}

export function validateNaupaReport(file: string, expected: ExpectedReport): ValidationError[] {
  const out: ValidationError[] = [];

  if (file.length === 0) return [err(0, "file", "file is empty")];
  if (/[^\x20-\x7e\r\n]/.test(file)) out.push(err(0, "file", "file contains non-ASCII or control characters"));

  const lines = splitRecords(file);
  // Bare CR or LF inside a record means the separator was not CR/LF (spec p.2).
  lines.forEach((l, i) => {
    if (/[\r\n]/.test(l)) out.push(err(i + 1, "separator", "records must be separated by CR/LF only"));
  });

  const records = lines.map(parseRecord);
  const allowed = new Set(expected.allowedPropertyCodes ?? (expected.rules ? allowedCodesFromRules(expected.rules) : []));
  if (allowed.size === 0) out.push(err(0, "PROP-PROPERTY-TYPE", "no allowed property-code set available (pass rules or allowedPropertyCodes)"));

  // Structure: HOLDER first, SUMINFO last, PROPERTY/PROPADD between (spec p.4). Single holder block.
  const types = records.map((r) => r.type);
  if (types[0] !== "holder") out.push(err(1, "TR-CODE", "first record must be HOLDER (TR-CODE 1)"));
  if (types[types.length - 1] !== "summary") out.push(err(records.length, "TR-CODE", "last record must be SUMINFO (TR-CODE 9)"));
  if (types.filter((t) => t === "holder").length !== 1) out.push(err(0, "TR-CODE", "exactly one HOLDER record is required"));
  if (types.filter((t) => t === "summary").length !== 1) out.push(err(0, "TR-CODE", "exactly one SUMINFO record is required"));

  let sumReported = 0;
  let sumDeduction = 0;
  let sumAdvertised = 0;
  let sumRemitted = 0;
  let propCount = 0;
  let expectSeq = 1;
  const byCode: Record<string, { count: number; cents: number }> = {};

  records.forEach((rec, idx) => {
    const n = idx + 1;
    if (rec.line.length !== RECORD_LENGTH) {
      out.push(err(n, "record", `record length is ${rec.line.length}, must be exactly ${RECORD_LENGTH}`));
    }
    if (rec.type === "unknown") {
      out.push(err(n, "TR-CODE", `unknown or reserved TR-CODE ${JSON.stringify(rec.trCode)}`));
      return;
    }
    const layout = LAYOUTS[rec.type];
    const isAggregate = rec.type === "property" && rec.fields["PROP-OWNER-TYPE-CODE"] === "AP";
    if (rec.type !== "propadd") {
      for (const def of layout.fields) checkField(rec, n, def, out, isAggregate && def.name.startsWith("PROP-OWNER-") && def.name !== "PROP-OWNER-TYPE-CODE" && def.name !== "PROP-OWNER-TYPE");
    }

    if (rec.type === "holder") validateHolder(rec, n, out, expected);
    if (rec.type === "property") {
      propCount++;
      const reported = amount(rec, "PROP-AMOUNT-REPORTED");
      const deduction = amount(rec, "PROP-DEDUCTION-AMOUNT");
      const advertised = amount(rec, "PROP-AMOUNT-ADVERTISED");
      const remitted = amount(rec, "PROP-AMOUNT-REMITTED");
      if ([reported, deduction, advertised, remitted].every(Number.isFinite)) {
        sumReported += reported;
        sumDeduction += deduction;
        sumAdvertised += advertised;
        sumRemitted += remitted;
        if (advertised !== reported - deduction) {
          out.push(err(n, "PROP-AMOUNT-ADVERTISED", `advertised ${advertised} must equal reported ${reported} minus deduction ${deduction}`));
        }
        if (expected.includesRemittance === true && remitted !== advertised) {
          out.push(err(n, "PROP-AMOUNT-REMITTED", `remittance stage: remitted ${remitted} must equal advertised ${advertised}`));
        }
        if (expected.includesRemittance === false && remitted !== 0) {
          out.push(err(n, "PROP-AMOUNT-REMITTED", "non-remittance stage: nothing may be remitted"));
        }
      }
      if (deduction > 0 && !rec.fields["PROP-DEDUCTION-TYPE"]) out.push(err(n, "PROP-DEDUCTION-TYPE", "mandatory when deduction amount > 0"));
      const seq = Number(rec.fields["PROP-SEQUENCE-NUMBER"]);
      if (seq !== expectSeq) out.push(err(n, "PROP-SEQUENCE-NUMBER", `expected sequence ${expectSeq}, got ${rec.fields["PROP-SEQUENCE-NUMBER"]}`));
      expectSeq++;

      const code = rec.fields["PROP-PROPERTY-TYPE"];
      if (code && allowed.size > 0 && !allowed.has(code)) {
        out.push(err(n, "PROP-PROPERTY-TYPE", `code ${code} is not in the ${expected.state} allowed set [${[...allowed].join(", ")}]`));
      }
      if (code) {
        const slot = (byCode[code] ??= { count: 0, cents: 0 });
        slot.count++;
        if (Number.isFinite(reported)) slot.cents += reported;
      }
      // Aggregate rows: owner-type AP <=> an aggregate (..99) property code (spec pp.17-18).
      const isAggCode = /^[A-Z]{2}99$/.test(code ?? "");
      if (isAggCode !== isAggregate) {
        out.push(err(n, "PROP-OWNER-TYPE-CODE", isAggCode ? "aggregate property code requires owner-type AP" : "owner-type AP requires an aggregate (..99) property code"));
      }
    }
  });

  // Summary
  const sumRec = records.find((r) => r.type === "summary");
  const sumNo = records.findIndex((r) => r.type === "summary") + 1;
  if (sumRec) {
    const check = (field: string, actual: number, want: number, label: string) => {
      if (actual !== want) out.push(err(sumNo, field, `${label}: summary says ${actual}, records give ${want}`));
    };
    check("SUMM-NBR-OF-RECORDS", amount(sumRec, "SUMM-NBR-OF-RECORDS"), records.length, "record count");
    check("SUMM-NBR-OF-PROPERTIES", amount(sumRec, "SUMM-NBR-OF-PROPERTIES"), propCount, "property count");
    check("SUMM-AMOUNT-REPORTED", amount(sumRec, "SUMM-AMOUNT-REPORTED"), sumReported, "amount reported");
    check("SUMM-DEDUCTION-AMOUNT", amount(sumRec, "SUMM-DEDUCTION-AMOUNT"), sumDeduction, "deduction");
    check("SUMM-AMOUNT-ADVERTISED", amount(sumRec, "SUMM-AMOUNT-ADVERTISED"), sumAdvertised, "amount advertised");
    check("SUMM-AMOUNT-REMITTED", amount(sumRec, "SUMM-AMOUNT-REMITTED"), sumRemitted, "amount remitted");
    const negative = sumRec.fields["SUMM-NEGATIVE-REPORT"] === "Y";
    if (negative !== (propCount === 0)) out.push(err(sumNo, "SUMM-NEGATIVE-REPORT", "negative-report flag must be Y exactly when there are no PROPERTY records (spec p.13)"));
  }

  // Expected totals (independent of the file's own summary)
  if (sumReported !== expected.totalCents) {
    out.push(err(0, "totals", `property records sum to ${sumReported} cents, expected ${expected.totalCents}`));
  }
  if (expected.propertyRecordCount !== undefined && propCount !== expected.propertyRecordCount) {
    out.push(err(0, "totals", `file has ${propCount} property records, expected ${expected.propertyRecordCount}`));
  }
  if (expected.byPropertyCode) {
    const codes = new Set([...Object.keys(expected.byPropertyCode), ...Object.keys(byCode)]);
    for (const c of codes) {
      const want = expected.byPropertyCode[c] ?? { count: 0, cents: 0 };
      const got = byCode[c] ?? { count: 0, cents: 0 };
      if (want.count !== got.count || want.cents !== got.cents) {
        out.push(err(0, "totals", `code ${c}: file has ${got.count} records / ${got.cents} cents, expected ${want.count} / ${want.cents}`));
      }
    }
  }
  return out;
}

function validateHolder(rec: NaupaRecord, n: number, out: ValidationError[], expected: ExpectedReport): void {
  const f = rec.fields;
  if (f["HOLDER-TAXID"] !== SYNTHETIC_HOLDER_TAXID) {
    out.push(err(n, "HOLDER-TAXID", `holder TIN must be the synthetic placeholder ${SYNTHETIC_HOLDER_TAXID}; real-looking TINs are never allowed in this prototype`));
  } else {
    out.push(warn(n, "HOLDER-TAXID", "SYNTHETIC placeholder TIN (00-0000000); a real filing needs the holder's real FEIN"));
  }
  if (f["HOLDER-TAXID-EXT"] !== SYNTHETIC_HOLDER_TAXID_EXT) {
    out.push(warn(n, "HOLDER-TAXID-EXT", `expected default ${SYNTHETIC_HOLDER_TAXID_EXT} (spec p.4)`));
  }
  if (!/^\d{4}$/.test(f["HOLDER-RPT-YEAR"] ?? "")) out.push(err(n, "HOLDER-RPT-YEAR", "report year must be 4 digits"));
  if (!/^(0[1-9]|[1-9]\d)$/.test(f["HOLDER-RPT-NUMBER"] ?? "")) out.push(err(n, "HOLDER-RPT-NUMBER", "report number must be 01-99"));
  if (expected.includesRemittance !== undefined) {
    const want = expected.includesRemittance ? "R" : "A";
    if (f["HOLDER-RPT-TYPE"] !== want && f["HOLDER-RPT-TYPE"] !== "T") {
      out.push(err(n, "HOLDER-RPT-TYPE", `stage ${expected.includesRemittance ? "remits funds" : "does not remit funds"}: expected report type ${want}, got ${f["HOLDER-RPT-TYPE"]}`));
    }
  }
}
