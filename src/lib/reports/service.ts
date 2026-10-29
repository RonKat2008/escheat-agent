/**
 * State report service: collects `to_report` stale items for one state, builds the NAUPA file with the
 * PINNED rule version, validates it, stores the report row + file under .data/reports, and builds the
 * evidence pack PDF. Approval (action submit_report, payload = file checksum) is recorded here; the
 * filing agent asserts the same approval before it submits anything.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { RuleFile } from "../../../rules/schema";
import type { Db } from "@/db/client";
import {
  companies,
  ledgerItems,
  outreach,
  payees,
  reports,
  staleItems,
  type Company,
  type Report,
  type StaleItem,
} from "@/db/schema";
import { approve, assertReviewedHash } from "@/lib/approvals";
import * as clock from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import type { IsoDate } from "@/lib/dates";
import { computeTimeline, type Timeline } from "@/lib/rules/engine";
import { listRuleValues } from "@/lib/rules/values";
import { loadRules, pinRules, tryLoadRules } from "@/lib/rules/load";
import { buildEvidencePack, type EvidenceItem, type OutreachEntry } from "./evidence-pack";
import { buildNaupaReport, expectedFromReport, type NaupaReportResult, type ReportHolder, type ReportItem } from "./naupa";
import type { ValidationError } from "./validate";
import { validateNaupaReport } from "./validate";

export const REPORT_DATA_DIR = path.join(process.cwd(), ".data", "reports");
export const SUPPORTED_REPORT_STATES = ["CA", "DE", "TX"] as const;

export class ReportServiceError extends Error {
  constructor(
    public readonly code: "no_rules" | "no_items" | "not_found" | "not_approvable" | "no_file",
    message: string,
  ) {
    super(message);
    this.name = "ReportServiceError";
  }
}

export interface ReportOptions {
  /** Where files are written (tests override). */
  dataDir?: string;
}

interface CollectedItem {
  stale: StaleItem;
  report: ReportItem;
  lastActivity: IsoDate;
}

function dirOf(opts: ReportOptions): string {
  return opts.dataDir ?? REPORT_DATA_DIR;
}

function splitName(raw: string): { last: string } {
  return { last: raw.trim() };
}

/** stale_items in `to_report` for the owner state, joined with payee + ledger details. */
async function collectItems(db: Db, companyId: string, state: string): Promise<CollectedItem[]> {
  const rows = await db
    .select()
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), eq(staleItems.status, "to_report")))
    .orderBy(asc(staleItems.createdAt), asc(staleItems.id));
  const out: CollectedItem[] = [];
  for (const stale of rows) {
    const [ledger] = await db.select().from(ledgerItems).where(eq(ledgerItems.id, stale.ledgerItemId));
    const payeeId = stale.ownerPayeeId ?? ledger?.payeeId ?? null;
    const [payee] = payeeId ? await db.select().from(payees).where(eq(payees.id, payeeId)) : [];
    const lastActivity = (stale.lastActivityDate ?? ledger?.lastActivityDate ?? ledger?.issueDate ?? stale.staleSince) as IsoDate;
    out.push({
      stale,
      lastActivity,
      report: {
        id: stale.id,
        propertyType: stale.propertyType,
        amountCents: stale.amountCents,
        lastActivityDate: lastActivity,
        ownerName: splitName(payee?.canonicalName ?? ledger?.payeeNameRaw ?? ""),
        isBusiness: true,
        address1: payee?.addressLine ?? ledger?.addressLine ?? undefined,
        city: payee?.city ?? ledger?.city ?? undefined,
        state: payee?.state ?? ledger?.state ?? undefined,
        zip: payee?.zip ?? ledger?.zip ?? undefined,
        referenceNumber: ledger?.referenceNumber ?? null,
        description: ledger?.memo ?? null,
      },
    });
  }
  return out;
}

/** Holder block from the company row. The contact is the company's own address; blanks stay blank and fail validation honestly. */
function holderOf(company: Company): ReportHolder {
  const hasAddress = Boolean(company.addressLine && company.city && company.hqState && company.zip);
  return {
    name: company.name,
    city: company.city ?? undefined,
    state: company.hqState ?? undefined,
    incorporatedState: company.incorporationState,
    ...(hasAddress
      ? {
          contact: {
            name: "Unclaimed Property Compliance",
            address1: company.addressLine!,
            city: company.city!,
            state: company.hqState!,
            zip: company.zip!,
            phoneAreaCode: "",
            phone: "",
          },
        }
      : {}),
  };
}

const mode = <T>(xs: readonly T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Pinned rule version of the items (the version their dates were computed with), else the current file. */
function rulesForItems(state: string, items: readonly CollectedItem[]): RuleFile {
  const version = mode(items.map((i) => i.stale.ruleVersion).filter((v): v is string => !!v));
  if (version) {
    try {
      return pinRules(state, version).file;
    } catch {
      /* pinned version missing on disk: fall back to the current file below */
    }
  }
  const current = tryLoadRules(state);
  if (!current) throw new ReportServiceError("no_rules", `No rule file for ${state}; only CA, DE and TX are supported.`);
  return current.file;
}

export interface GeneratedReport {
  report: Report;
  errors: ValidationError[];
  warnings: string[];
  excludedItemIds: string[];
  totals: NaupaReportResult["totals"];
}

/** Drafts and validated-but-unapproved reports for the same state/year are replaced by the new one. */
async function supersedeOpenReports(db: Db, companyId: string, state: string, year: number) {
  const old = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.companyId, companyId),
        eq(reports.state, state),
        eq(reports.reportYear, year),
        inArray(reports.status, ["draft", "validated", "awaiting_approval", "failed"]),
      ),
    );
  for (const r of old) {
    if (r.filePath) await rm(resolveStored(r.filePath), { force: true }).catch(() => undefined);
    if (r.evidencePackPath) await rm(resolveStored(r.evidencePackPath), { force: true }).catch(() => undefined);
    await db.delete(reports).where(eq(reports.id, r.id));
  }
}

export async function generateStateReport(
  db: Db,
  companyId: string,
  stateInput: string,
  opts: ReportOptions = {},
): Promise<GeneratedReport> {
  const state = stateInput.toUpperCase();
  const loadedCurrent = tryLoadRules(state);
  if (!loadedCurrent) throw new ReportServiceError("no_rules", `No rule file for ${state}; only CA, DE and TX are supported.`);
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new ReportServiceError("not_found", `Unknown company ${companyId}`);
  const items = await collectItems(db, companyId, state);
  if (items.length === 0) throw new ReportServiceError("no_items", `No ${state} items are in To Report yet. Nothing to file.`);

  const rules = rulesForItems(state, items);
  const stageName = mode(items.map((i) => i.stale.reportStage).filter((s): s is string => !!s)) ?? rules.reportStages[0]?.name;
  if (!stageName) throw new ReportServiceError("no_rules", `${state} rule file has no report stages.`);

  const today = await clock.now(db, companyId);
  const year = Number(today.slice(0, 4));
  const result = buildNaupaReport({
    holder: holderOf(company),
    state,
    period: { start: `${year}-01-01`, end: today },
    stage: stageName,
    items: items.map((i) => i.report),
    rules,
  });
  const validation = validateNaupaReport(result.file, expectedFromReport(result, state, rules));
  const errors = [...result.errors, ...validation.filter((v) => !result.errors.some((e) => e.message === v.message && e.field === v.field))];
  const hasErrors = errors.some((e) => e.severity === "error");
  const checksum = sha256Hex(result.file);

  const dir = dirOf(opts);
  await supersedeOpenReports(db, companyId, state, year);
  const [row] = await db
    .insert(reports)
    .values({
      companyId,
      state,
      reportYear: year,
      format: "naupa",
      stage: stageName,
      status: hasErrors ? "draft" : "validated",
      totalCents: result.totals.totalCents,
      itemCount: result.totals.itemCount,
      checksum,
      validationErrors: errors,
    })
    .returning();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${row!.id}.txt`);
  await writeFile(file, result.file, "latin1");
  const [saved] = await db
    .update(reports)
    .set({ filePath: path.relative(process.cwd(), file) })
    .where(eq(reports.id, row!.id))
    .returning();
  return { report: saved!, errors, warnings: result.warnings, excludedItemIds: result.excludedItemIds, totals: result.totals };
}

export async function getReport(db: Db, id: string): Promise<Report | null> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id));
  return row ?? null;
}

function resolveStored(p: string): string {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export async function readReportFile(db: Db, id: string): Promise<{ report: Report; text: string }> {
  const report = await getReport(db, id);
  if (!report) throw new ReportServiceError("not_found", `Report ${id} not found`);
  if (!report.filePath) throw new ReportServiceError("no_file", "This report has no file yet.");
  const text = await readFile(resolveStored(report.filePath), "latin1");
  return { report, text };
}

async function outreachEntries(db: Db, staleItemId: string): Promise<OutreachEntry[]> {
  const rows = await db.select().from(outreach).where(eq(outreach.staleItemId, staleItemId)).orderBy(asc(outreach.createdAt));
  return rows
    .filter((r) => r.status !== "draft" && r.status !== "cancelled")
    .map((r) => ({
      channel: r.channel === "voice" ? "call" : r.channel,
      at: (r.sentAt ?? r.createdAt).toISOString(),
      status: r.status,
      to: r.toAddress ?? undefined,
      ...(r.channel === "letter" ? { lobLetterId: r.providerId ?? undefined, lobUrl: r.previewUrl ?? undefined } : {}),
      ...(r.channel === "email" ? { emailId: r.providerId ?? undefined } : {}),
    }));
}

/** Rebuilds the exact NAUPA result from the stored file's items and writes the evidence pack PDF. */
export async function buildReportEvidencePack(
  db: Db,
  reportId: string,
  opts: ReportOptions = {},
): Promise<{ report: Report; path: string; sha256: string; pageCount: number; unverifiedCount: number }> {
  const report = await getReport(db, reportId);
  if (!report) throw new ReportServiceError("not_found", `Report ${reportId} not found`);
  const items = await collectItems(db, report.companyId, report.state);
  if (items.length === 0) throw new ReportServiceError("no_items", "No items remain in To Report for this state; regenerate the report.");
  const rules = rulesForItems(report.state, items);
  const [company] = await db.select().from(companies).where(eq(companies.id, report.companyId));
  const today = await clock.now(db, report.companyId);
  const result = buildNaupaReport({
    holder: holderOf(company!),
    state: report.state,
    period: { start: `${report.reportYear}-01-01`, end: today },
    stage: report.stage ?? rules.reportStages[0]!.name,
    items: items.map((i) => i.report),
    rules,
  });
  const evidenceItems: EvidenceItem[] = [];
  for (const i of items) {
    let timeline: Timeline | null = null;
    try {
      timeline = computeTimeline(
        {
          propertyType: i.stale.propertyType,
          lastActivityDate: i.lastActivity,
          amountCents: i.stale.amountCents,
          ownerState: report.state,
          holderFiscalYearEnd: company!.fiscalYearEnd,
        },
        rules,
      );
    } catch {
      timeline = null;
    }
    evidenceItems.push({ item: i.report, timeline, outreach: await outreachEntries(db, i.stale.id), ownerResponses: [] });
  }
  const pack = await buildEvidencePack({ report: result, items: evidenceItems, ruleFiles: [rules] });
  const dir = dirOf(opts);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${reportId}-evidence.pdf`);
  await writeFile(file, pack.bytes);
  const [saved] = await db
    .update(reports)
    .set({ evidencePackPath: path.relative(process.cwd(), file) })
    .where(eq(reports.id, reportId))
    .returning();
  return { report: saved!, path: file, sha256: pack.sha256, pageCount: pack.pageCount, unverifiedCount: pack.unverifiedCount };
}

export async function readEvidencePack(db: Db, reportId: string, opts: ReportOptions = {}): Promise<Uint8Array> {
  let report = await getReport(db, reportId);
  if (!report) throw new ReportServiceError("not_found", `Report ${reportId} not found`);
  if (!report.evidencePackPath) {
    report = (await buildReportEvidencePack(db, reportId, opts)).report;
  }
  return readFile(resolveStored(report.evidencePackPath!));
}

/** Records the human approval for submit_report bound to the file checksum. Does not file anything. */
export async function approveReport(
  db: Db,
  reportId: string,
  approvedBy: string,
  opts: { expectedChecksum?: string } = {},
): Promise<Report> {
  const report = await getReport(db, reportId);
  if (!report) throw new ReportServiceError("not_found", `Report ${reportId} not found`);
  if (report.status !== "validated" && report.status !== "awaiting_approval") {
    throw new ReportServiceError(
      "not_approvable",
      report.status === "draft"
        ? "This report has validation errors. Fix them and regenerate before approving."
        : `Report is already ${report.status.replace("_", " ")}.`,
    );
  }
  if (!report.checksum) throw new ReportServiceError("no_file", "Report has no file checksum.");
  assertReviewedHash(opts.expectedChecksum, report.checksum, "report file");
  const approval = await approve(db, {
    action: "submit_report",
    subjectId: report.id,
    payload: report.checksum,
    approvedBy,
  });
  const [saved] = await db
    .update(reports)
    .set({ status: "approved", approvalId: approval.id })
    .where(eq(reports.id, report.id))
    .returning();
  return saved!;
}

export interface StateReportSummary {
  state: string;
  ruleVersion: string | null;
  /** Rule values in the pinned file with verified:false (shown as UNVERIFIED). */
  ruleUnverifiedCount: number;
  stage: string | null;
  toReportCount: number;
  toReportCents: number;
  latest: Report | null;
  history: Report[];
}

export async function listReportSummaries(db: Db, companyId: string): Promise<StateReportSummary[]> {
  const out: StateReportSummary[] = [];
  for (const state of SUPPORTED_REPORT_STATES) {
    const items = await db
      .select({ amountCents: staleItems.amountCents, stage: staleItems.reportStage })
      .from(staleItems)
      .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), eq(staleItems.status, "to_report")));
    const rows = await db
      .select()
      .from(reports)
      .where(and(eq(reports.companyId, companyId), eq(reports.state, state)))
      .orderBy(desc(reports.createdAt));
    const rules = (() => {
      try {
        return loadRules(state).file;
      } catch {
        return null;
      }
    })();
    out.push({
      state,
      ruleVersion: rules?.version ?? null,
      ruleUnverifiedCount: rules ? listRuleValues(rules).filter((v) => !v.rv.verified).length : 0,
      stage: mode(items.map((i) => i.stage).filter((s): s is string => !!s)) ?? rules?.reportStages[0]?.name ?? null,
      toReportCount: items.length,
      toReportCents: items.reduce((s, i) => s + i.amountCents, 0),
      latest: rows[0] ?? null,
      history: rows.slice(1),
    });
  }
  return out;
}
