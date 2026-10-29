/**
 * Adapter between the replica portal and the NAUPA II fixed-width file.
 *
 * The portal only needs a summary (holder, report type, item count, total, per-code
 * breakdown, problems). Parsing is delegated to `parseNaupaReport` (src/lib/reports/parse.ts);
 * this module turns its output into the small `NaupaUploadSummary` contract the pages use,
 * so swapping the parser later only touches `parseNaupaUpload`.
 */
import { z } from "zod";
import { parseNaupaReport } from "@/lib/reports/parse";

export const MAX_UPLOAD_BYTES = 2_000_000;
export const RECORD_LENGTH = 625;

export type ProblemSeverity = "error" | "warning";
export interface NaupaProblem {
  severity: ProblemSeverity;
  message: string;
}
export interface CodeBreakdown {
  code: string;
  count: number;
  totalCents: number;
}
export interface NaupaUploadSummary {
  holderName: string | null;
  reportType: string | null;
  reportTypeLabel: string;
  reportYear: string | null;
  itemCount: number;
  totalCents: number;
  byPropertyCode: CodeBreakdown[];
  problems: NaupaProblem[];
}

export const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1, "The file is empty.").max(MAX_UPLOAD_BYTES, "The file is too large."),
});

const REPORT_TYPE_LABELS: Record<string, string> = {
  A: "Advertising (no remittance)",
  R: "Remittance",
  T: "Test",
};

const CRLF = "\r\n";

export function parseNaupaUpload(content: string): NaupaUploadSummary {
  const problems: NaupaProblem[] = [];
  const err = (message: string) => problems.push({ severity: "error", message });
  const warn = (message: string) => problems.push({ severity: "warning", message });

  // Browsers may deliver bare LF (pasted text); the NAUPA parser requires CR/LF.
  const normalized = content.replace(/\r?\n/g, CRLF);
  const report = parseNaupaReport(normalized);

  report.records.forEach((r, i) => {
    if (r.type === "unknown") err(`Record ${i + 1}: unsupported TR-CODE "${r.trCode}".`);
    else if (r.line.length !== RECORD_LENGTH) {
      warn(`Record ${i + 1}: ${r.line.length} bytes, expected ${RECORD_LENGTH}.`);
    }
  });

  const holder = report.holder;
  if (report.lineCount === 0) err("The file has no records.");
  else if (!holder) err("No HOLDER record (TR-CODE 1) found.");
  else {
    if (!holder.name) err("HOLDER-NAME is blank.");
    if (!(holder.reportType in REPORT_TYPE_LABELS)) {
      err(`HOLDER-RPT-TYPE "${holder.reportType}" is not one of A, R, T.`);
    }
  }
  if (report.records.filter((r) => r.type === "holder").length > 1) {
    err("More than one HOLDER record; this portal accepts one holder per file.");
  }

  let totalCents = 0;
  const codes = new Map<string, CodeBreakdown>();
  for (const p of report.properties) {
    if (!Number.isFinite(p.amountReportedCents)) {
      err(`PROPERTY ${p.sequence}: PROP-AMOUNT-REPORTED is not numeric.`);
      continue;
    }
    const code = p.propertyType || "(none)";
    if (!p.propertyType) warn(`PROPERTY ${p.sequence}: PROP-PROPERTY-TYPE is blank.`);
    totalCents += p.amountReportedCents;
    const prev = codes.get(code) ?? { code, count: 0, totalCents: 0 };
    codes.set(code, { code, count: prev.count + 1, totalCents: prev.totalCents + p.amountReportedCents });
  }
  const itemCount = report.properties.length;

  const s = report.summary;
  if (report.lineCount > 0 && !s) err("No SUMINFO record (TR-CODE 9) found.");
  if (s) {
    if (s.propertyCount !== itemCount) {
      err(`SUMINFO reports ${s.propertyCount} properties but the file contains ${itemCount}.`);
    }
    if (s.amountReportedCents !== totalCents) {
      err(`SUMINFO amount ${s.amountReportedCents} cents does not match the property total ${totalCents} cents.`);
    }
    if (s.recordCount !== report.lineCount) {
      warn(`SUMINFO reports ${s.recordCount} records but the file contains ${report.lineCount}.`);
    }
  }
  if (holder && itemCount === 0) warn("No PROPERTY records: this is a negative report.");

  const reportType = holder?.reportType || null;
  return {
    holderName: holder?.name || null,
    reportType,
    reportTypeLabel: reportType ? (REPORT_TYPE_LABELS[reportType] ?? "Unknown") : "Unknown",
    reportYear: holder?.reportYear || null,
    itemCount,
    totalCents,
    byPropertyCode: [...codes.values()].sort((a, b) => a.code.localeCompare(b.code)),
    problems,
  };
}

export const hasBlockingProblems = (s: Pick<NaupaUploadSummary, "problems">): boolean =>
  s.problems.some((p) => p.severity === "error");
