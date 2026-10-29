/**
 * NAUPA II file writer. Builds the fixed-width report (HOLDER, PROPERTY..., SUMINFO) from ledger items
 * and a state rule file. Property type codes come ONLY from the rule file (a null code is a validation
 * error and the item is left out of the file); the aggregate threshold comes only from the rule file too
 * (unknown => no aggregation + warning). See layout.ts for the field table and spec citations.
 */

import type { RuleFile, RulePropertyType } from "../../../rules/schema";
import {
  aggregateCodeFor,
  EncodeError,
  encodeRecord,
  isoToCompact,
  LAYOUTS,
  RECORD_SEPARATOR,
  sanitizeAscii,
  type FieldValue,
  type RecordLayout,
} from "./layout";
import type { NaupaRecord } from "./parse";
import {
  SYNTHETIC_HOLDER_TAXID,
  SYNTHETIC_HOLDER_TAXID_EXT,
  validateNaupaReport,
  type ExpectedReport,
  type ValidationError,
} from "./validate";

export const SOFTWARE_VERSION = "ESCHEAT-AGENT 0.1";
export const CREATOR = "ESCHEAT AGENT";

export interface ReportContact {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  /** ISO 3-letter, default USA. */
  country?: string;
  /** 3 digits */
  phoneAreaCode: string;
  /** 7 digits */
  phone: string;
  email?: string;
}

export interface ReportHolder {
  name: string;
  city?: string;
  county?: string;
  state?: string;
  incorporatedState?: string;
  /** ISO date */
  incorporationDate?: string;
  sicCode?: string;
  naicsCode?: string;
  contact?: ReportContact;
  // Deliberately no TIN field: the holder TIN is always the synthetic placeholder.
}

export interface ReportItem {
  id: string;
  propertyType: RulePropertyType;
  amountCents: number;
  /** ISO date of last owner activity / check issue date. */
  lastActivityDate: string | null;
  ownerName: { last: string; first?: string; middle?: string };
  /** Business payee (PROP-NAME-ID = C). Default true. */
  isBusiness?: boolean;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  referenceNumber?: string | null;
  description?: string | null;
}

export type ReportType = "advertising" | "remittance" | "test";

export interface BuildNaupaInput {
  holder: ReportHolder;
  state: string;
  /** Overrides the type derived from the stage (A / R / T). */
  reportType?: ReportType;
  period: { start: string; end: string };
  /** Name of a stage in rules.reportStages (e.g. CA "notice" or "remit", DE/TX "annual"). */
  stage: string;
  items: readonly ReportItem[];
  rules: RuleFile;
  /** Aggregate items under the rule-file threshold (default true). */
  aggregateSmall?: boolean;
  /** Report number 1-99, default 1. */
  reportNumber?: number;
}

export interface NaupaTotals {
  /** Source items included in the file (aggregated items count individually). */
  itemCount: number;
  totalCents: number;
  /** PROPERTY records written (an aggregate row counts once). */
  propertyRecordCount: number;
  /** Keyed by the code on the record (aggregate rows under CK99 / MS99). */
  byPropertyCode: Record<string, { count: number; cents: number }>;
}

export interface NaupaReportResult {
  holder: ReportHolder;
  state: string;
  period: { start: string; end: string };
  file: string;
  records: NaupaRecord[];
  totals: NaupaTotals;
  warnings: string[];
  /** Blocking problems: items left out of the file plus validator errors. Empty means the file passed its own validator. */
  errors: ValidationError[];
  excludedItemIds: string[];
  stage: { name: string; includesRemittance: boolean };
  /** Header report type actually written (A / R / T). */
  reportTypeCode: "A" | "R" | "T";
}

const REPORT_TYPE_CODE: Record<ReportType, "A" | "R" | "T"> = { advertising: "A", remittance: "R", test: "T" };

function enc(layout: RecordLayout, values: Record<string, FieldValue>, label: string, warnings: string[]) {
  const r = encodeRecord(layout, values);
  for (const t of r.truncated) warnings.push(`${label}: ${t} truncated to fit the spec's field length`);
  return r;
}

function toRecord(layout: RecordLayout, r: ReturnType<typeof encodeRecord>): NaupaRecord {
  return { type: layout.kind, trCode: layout.trCode, fields: r.fields, line: r.line };
}

interface Row {
  item: ReportItem;
  code: string;
}

export function buildNaupaReport(input: BuildNaupaInput): NaupaReportResult {
  const { holder, rules, items } = input;
  const warnings: string[] = [];
  const errors: ValidationError[] = [];
  const excludedItemIds: string[] = [];

  if (rules.state !== input.state) throw new Error(`rule file is for ${rules.state}, report is for ${input.state}`);
  const stage = rules.reportStages.find((s) => s.name === input.stage);
  if (!stage) throw new Error(`${input.state} has no report stage ${JSON.stringify(input.stage)} (have: ${rules.reportStages.map((s) => s.name).join(", ")})`);

  const reportType: ReportType = input.reportType ?? (stage.includesRemittance ? "remittance" : "advertising");
  const reportTypeCode = REPORT_TYPE_CODE[reportType];
  if (reportType === "advertising" && stage.includesRemittance) {
    warnings.push(`stage ${stage.name} remits funds but report type is advertising (A)`);
  }
  if (reportType === "remittance" && !stage.includesRemittance) {
    warnings.push(`stage ${stage.name} does not remit funds but report type is remittance (R)`);
  }
  if (input.state === "CA" && reportTypeCode === "A") {
    warnings.push("CA notice report written with HOLDER-RPT-TYPE A: whether SCO expects A on Notice Reports was not confirmed (docs/naupa-format.md)");
  }
  const remits = reportType === "remittance" || (reportType === "test" && stage.includesRemittance);

  // 1. Resolve each item's code from the rule file; no code => error, item left out.
  const rows: Row[] = [];
  for (const [idx, item] of items.entries()) {
    const rule = rules.propertyTypes[item.propertyType];
    const code = rule?.naupaCode.value ?? null;
    if (!code) {
      excludedItemIds.push(item.id);
      errors.push({ record: 0, field: "PROP-PROPERTY-TYPE", message: `item ${item.id} (#${idx + 1}): ${input.state} rule file has no NAUPA code for property type ${item.propertyType}; item left out of the file`, severity: "error" });
      continue;
    }
    if (!Number.isSafeInteger(item.amountCents) || item.amountCents < 0 || item.amountCents > 9_999_999_999) {
      excludedItemIds.push(item.id);
      errors.push({ record: 0, field: "PROP-AMOUNT-REPORTED", message: `item ${item.id}: amount ${item.amountCents} cents is not representable (10 digits, non-negative integer cents); item left out of the file`, severity: "error" });
      continue;
    }
    if (item.ownerName.last.trim() === "") {
      excludedItemIds.push(item.id);
      errors.push({ record: 0, field: "PROP-OWNER-NAME-LAST", message: `item ${item.id}: owner name is mandatory; item left out of the file`, severity: "error" });
      continue;
    }
    rows.push({ item, code });
  }

  // 2. Aggregation by rule-file threshold.
  const named: Row[] = [];
  const aggGroups = new Map<string, Row[]>();
  const unknownThreshold = new Set<RulePropertyType>();
  for (const row of rows) {
    const threshold = rules.propertyTypes[row.item.propertyType]?.aggregateThresholdCents.value ?? null;
    if (threshold === null) unknownThreshold.add(row.item.propertyType);
    const small = input.aggregateSmall !== false && threshold !== null && row.item.amountCents < threshold;
    const aggCode = small ? aggregateCodeFor(row.code) : null;
    if (small && !aggCode) {
      warnings.push(`item ${row.item.id}: under the aggregate threshold but NAUPA has no aggregate code for ${row.code}; reported individually`);
    }
    if (aggCode) aggGroups.set(aggCode, [...(aggGroups.get(aggCode) ?? []), row]);
    else named.push(row);
  }
  if (input.aggregateSmall !== false) {
    for (const pt of unknownThreshold) {
      warnings.push(`${input.state} aggregate threshold for ${pt} is unknown in the rule file: no aggregation applied, every item reported individually`);
    }
  }
  if (input.state === "DE" && aggGroups.size > 0) {
    warnings.push("aggregate owner-type code AP written per NAUPA spec p.18; DE Holder Handbook p.39 shows AG (unconfirmed which DE accepts)");
  }

  // 3. Records
  const records: NaupaRecord[] = [];
  const lines: string[] = [];
  const push = (layout: RecordLayout, r: ReturnType<typeof encodeRecord>) => {
    records.push(toRecord(layout, r));
    lines.push(r.line);
  };

  const rptYear = input.period.end.slice(0, 4);
  const contact = holder.contact;
  try {
    push(
      LAYOUTS.holder,
      enc(
        LAYOUTS.holder,
        {
          "HOLDER-TAXID": SYNTHETIC_HOLDER_TAXID,
          "HOLDER-TAXID-EXT": SYNTHETIC_HOLDER_TAXID_EXT,
          "HOLDER-RPT-YEAR": rptYear,
          "HOLDER-RPT-TYPE": reportTypeCode,
          "HOLDER-RPT-NUMBER": String(input.reportNumber ?? 1).padStart(2, "0"),
          "HOLDER-RPT-FORMAT": "R",
          "HOLDER-SIC-CODE": holder.sicCode,
          "HOLDER-INCORPORATED-STATE": holder.incorporatedState,
          "HOLDER-INC-DATE": holder.incorporationDate ? isoToCompact("HOLDER-INC-DATE", holder.incorporationDate) : null,
          "HOLDER-NAME": holder.name,
          "HOLDER-CITY": holder.city,
          "HOLDER-COUNTY": holder.county,
          "HOLDER-STATE": holder.state,
          "HOLDER-CONTACT1-NAME": contact?.name,
          "HOLDER-CONTACT1-ADDR1": contact?.address1,
          "HOLDER-CONTACT1-ADDR2": contact?.address2,
          "HOLDER-CONTACT1-CITY": contact?.city,
          "HOLDER-CONTACT1-STATE": contact?.state,
          "HOLDER-CONTACT1-ZIP": contact?.zip,
          "HOLDER-CONTACT1-COUNTRY": contact ? (contact.country ?? "USA") : undefined,
          "HOLDER-CONTACT1-TEL-AC": contact?.phoneAreaCode,
          "HOLDER-CONTACT1-TEL-NBR": contact?.phone,
          "HOLDER-CONTACT1-EMAIL": contact?.email,
          "HOLDER-NAICS-CODE": holder.naicsCode,
        },
        "HOLDER",
        warnings,
      ),
    );
  } catch (e) {
    if (!(e instanceof EncodeError)) throw e;
    throw new Error(`holder record cannot be encoded: ${e.message}`);
  }

  const byPropertyCode: Record<string, { count: number; cents: number }> = {};
  let totalCents = 0;
  let itemCount = 0;
  let seq = 0;
  const addTotals = (code: string, cents: number, items: number) => {
    const slot = (byPropertyCode[code] ??= { count: 0, cents: 0 });
    slot.count += 1;
    slot.cents += cents;
    totalCents += cents;
    itemCount += items;
  };
  const amountFields = (cents: number) => ({
    "PROP-AMOUNT-REPORTED": cents,
    "PROP-DEDUCTION-AMOUNT": 0,
    "PROP-AMOUNT-ADVERTISED": cents,
    "PROP-ADDITION-AMOUNT": 0,
    "PROP-DELETION-AMOUNT": 0,
    "PROP-AMOUNT-REMITTED": remits ? cents : 0,
  });

  for (const { item, code } of named) {
    seq++;
    const label = `PROPERTY ${seq} (item ${item.id})`;
    try {
      push(
        LAYOUTS.property,
        enc(
          LAYOUTS.property,
          {
            "PROP-SEQUENCE-NUMBER": seq,
            "PROP-NAME-ID": item.isBusiness === false ? "" : "C",
            "PROP-OWNER-NAME-LAST": item.ownerName.last,
            "PROP-OWNER-NAME-FIRST": item.ownerName.first,
            "PROP-OWNER-NAME-MIDDLE": item.ownerName.middle,
            "PROP-OWNER-ADDRESS1": item.address1,
            "PROP-OWNER-ADDRESS2": item.address2,
            "PROP-OWNER-CITY": item.city,
            "PROP-OWNER-STATE": item.state,
            "PROP-OWNER-ZIP": item.zip?.replace(/[^0-9A-Za-z]/g, ""),
            "PROP-OWNER-COUNTRY": item.state ? "USA" : undefined,
            "PROP-ST-TRANS-DATE": item.lastActivityDate,
            "PROP-PROPERTY-TYPE": code,
            ...amountFields(item.amountCents),
            "PROP-CHECK-NUMBER": item.referenceNumber,
            "PROP-DESCRIPTION": item.description,
            "PROP-RELATIONSHIP-CODE": "PA",
            "PROP-OWNER-TYPE-CODE": "OT",
          },
          label,
          warnings,
        ),
      );
      addTotals(code, item.amountCents, 1);
    } catch (e) {
      if (!(e instanceof EncodeError)) throw e;
      seq--;
      excludedItemIds.push(item.id);
      errors.push({ record: 0, field: e.field, message: `item ${item.id}: ${e.message}; item left out of the file`, severity: "error" });
    }
  }

  for (const [aggCode, group] of [...aggGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    seq++;
    const cents = group.reduce((s, r) => s + r.item.amountCents, 0);
    const latest = group.map((r) => r.item.lastActivityDate).filter((d): d is string => !!d).sort().pop() ?? null;
    warnings.push(`${aggCode}: ${group.length} item(s) under the threshold reported as one aggregate row; its last-activity date is the latest of the group`);
    try {
      push(
        LAYOUTS.property,
        enc(
          LAYOUTS.property,
          {
            "PROP-SEQUENCE-NUMBER": seq,
            "PROP-NAME-ID": "",
            "PROP-OWNER-NAME-LAST": "AGGREGATE",
            "PROP-ST-TRANS-DATE": latest,
            "PROP-PROPERTY-TYPE": aggCode,
            ...amountFields(cents),
            "PROP-DESCRIPTION": `AGGREGATE OF ${group.length} ITEMS`,
            "PROP-RELATIONSHIP-CODE": "UN",
            "PROP-OWNER-TYPE-CODE": "AP",
          },
          `PROPERTY ${seq} (aggregate ${aggCode})`,
          warnings,
        ),
      );
      addTotals(aggCode, cents, group.length);
    } catch (e) {
      if (!(e instanceof EncodeError)) throw e;
      seq--;
      for (const r of group) excludedItemIds.push(r.item.id);
      errors.push({ record: 0, field: e.field, message: `aggregate ${aggCode}: ${e.message}; ${group.length} items left out of the file`, severity: "error" });
    }
  }

  const summaryContact = sanitizeAscii([contact?.name, contact?.email].filter(Boolean).join(" ")) || "SYNTHETIC PROTOTYPE";
  push(
    LAYOUTS.summary,
    enc(
      LAYOUTS.summary,
      {
        "SUMM-NBR-OF-RECORDS": lines.length + 1,
        "SUMM-NBR-OF-PROPERTIES": seq,
        "SUMM-AMOUNT-REPORTED": totalCents,
        "SUMM-DEDUCTION-AMOUNT": 0,
        "SUMM-AMOUNT-ADVERTISED": totalCents,
        "SUMM-ADDITION-AMOUNT": 0,
        "SUMM-DELETION-AMOUNT": 0,
        "SUMM-AMOUNT-REMITTED": remits ? totalCents : 0,
        "SUMM-NEGATIVE-REPORT": seq === 0 ? "Y" : "",
        "SUMM-SOFTWARE-VERSION": SOFTWARE_VERSION,
        "SUMM-CREATOR": CREATOR,
        "SUMM-CREATOR-CONTACT": summaryContact,
      },
      "SUMINFO",
      warnings,
    ),
  );

  const file = lines.join(RECORD_SEPARATOR);
  const totals: NaupaTotals = { itemCount, totalCents, propertyRecordCount: seq, byPropertyCode };

  // 4. Run the independent validator over our own output.
  const expected: ExpectedReport = {
    state: input.state,
    totalCents,
    propertyRecordCount: seq,
    byPropertyCode,
    rules,
    includesRemittance: reportType === "test" ? undefined : stage.includesRemittance,
  };
  for (const v of validateNaupaReport(file, expected)) {
    if (v.severity === "error") errors.push(v);
    else warnings.push(`record ${v.record} ${v.field}: ${v.message}`);
  }

  return {
    holder,
    state: input.state,
    period: input.period,
    file,
    records,
    totals,
    warnings,
    errors,
    excludedItemIds,
    stage: { name: stage.name, includesRemittance: stage.includesRemittance },
    reportTypeCode,
  };
}

/** Expected-totals object for validateNaupaReport built from a build result. */
export function expectedFromReport(result: NaupaReportResult, state: string, rules: RuleFile): ExpectedReport {
  return {
    state,
    totalCents: result.totals.totalCents,
    propertyRecordCount: result.totals.propertyRecordCount,
    byPropertyCode: result.totals.byPropertyCode,
    rules,
    includesRemittance: result.reportTypeCode === "T" ? undefined : result.stage.includesRemittance,
  };
}
