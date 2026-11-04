/**
 * R7-01: California's two-stage cycle across demo-clock jumps. The notice report is filed on Nov 1, 2026; its item
 * (Callum Whitlock, $1,574.10) then waits on the remit stage, due on its engine-computed remit date. Before that date
 * the runner shows it as scheduled; once it opens, the runner files the remit report and records the remittance.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { reports, staleItems } from "@/db/schema";
import { advanceClock } from "@/lib/clock";
import { generateStateReport } from "@/lib/reports/service";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { draftFilingRecord } from "./filing-record";
import { followUpStageOf, isFollowUpReport, loadRemitStage, REMIT_STAGE_OPENS_DAYS_BEFORE } from "./remit-stage";
import { recordRemittance, remittanceOwed, RemittanceError } from "./remittance";
import { buildRunner } from "./runner";
import { daysBetween } from "./runner-model";
import { tryLoadRules } from "@/lib/rules/load";

const ITEMS: FixtureItem[] = [
  // Filed on the Nov 1, 2026 notice report: reported, remit stage due Jun 15, 2027 (engine dates, UNVERIFIED).
  { key: "callum", check: "10327", payee: "Callum Whitlock", cents: 157_410, issueDate: "2022-01-01", state: "CA", status: "reported", report: "2026-10-31", remit: "2027-06-15", unverified: true },
  // The next notice cycle, already To Report: it must not move when the remit report is filed.
  { key: "raven", check: "10400", payee: "Ravenhill Supply", cents: 219_470, issueDate: "2023-01-01", state: "CA", status: "to_report", report: "2027-10-31", remit: "2028-06-15", unverified: true },
];

let t: TestDb;
let companyId: string;
let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];
let noticeId: string;
let dataDir: string;

async function jumpTo(date: string) {
  await advanceClock(t.db, companyId, daysBetween("2026-11-01", date) - (await currentOffset()));
}
async function currentOffset(): Promise<number> {
  const { getOffsetDays } = await import("@/lib/clock");
  return getOffsetDays(t.db, companyId);
}

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  const f = await insertFixture(t.db, ITEMS);
  companyId = f.companyId;
  ids = f.ids;
  dataDir = await mkdtemp(path.join(tmpdir(), "remit-stage-"));
  const [n] = await t.db
    .insert(reports)
    .values({ companyId, state: "CA", reportYear: 2026, stage: "notice", status: "submitted", itemCount: 1, totalCents: 157_410, checksum: "c".repeat(64), validationErrors: [], replicaConfirmation: "REPL-CA-1", submittedAt: new Date("2026-11-01T10:00:00Z") })
    .returning();
  noticeId = n!.id;
  // The frozen record of the notice filing (its next stage is the remit report, the items' engine remit date).
  await t.db
    .update(reports)
    .set({ filingRecord: { ...(await draftFilingRecord(t.db, n!, { approvedBy: "Dana Ruiz" })), approvedAt: null, approvalId: null } })
    .where(eq(reports.id, noticeId));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("followUpStageOf", () => {
  it("is CA's remit stage after its notice stage, and nothing for single-stage states", () => {
    expect(followUpStageOf(tryLoadRules("CA")!.file, "notice")).toMatchObject({ name: "remit", prior: "notice" });
    expect(followUpStageOf(tryLoadRules("CA")!.file, "remit")).toBeNull();
    expect(followUpStageOf(tryLoadRules("TX")!.file, null)).toBeNull();
    expect(isFollowUpReport({ state: "CA", stage: "remit" })).toBe(true);
    expect(isFollowUpReport({ state: "CA", stage: "notice" })).toBe(false);
    expect(isFollowUpReport({ state: "TX", stage: "annual" })).toBe(false);
  });
});

describe("CA two-stage cycle across a clock jump (R7-01)", () => {
  it("Nov 1, 2026: the remit stage is scheduled from the rule-file date; nothing is owed", async () => {
    const stage = await loadRemitStage(t.db, companyId, "CA", "2026-11-01");
    expect(stage).toMatchObject({ count: 1, totalCents: 157_410, open: false, opensOn: "2027-06-01", remitDue: { date: "2027-06-15", unverified: true }, noticeFiledOn: "2026-11-01" });
    expect(REMIT_STAGE_OPENS_DAYS_BEFORE).toBe(14);
    // remittanceOwed: a notice-stage filing carries no money.
    expect(await remittanceOwed(t.db, companyId, "CA")).toBeNull();
    await expect(recordRemittance(t.db, { companyId, state: "CA", reportId: noticeId, approvedBy: "Dana Ruiz", remittedOn: "2026-11-01", expectedCount: 1, expectedCents: 157_410 })).rejects.toBeInstanceOf(RemittanceError);
    const v = await buildRunner(t.db, companyId, "CA");
    expect(v.stageName).toBeNull();
    const remit = v.steps.find((s) => s.id === "remit")!;
    expect(remit.tone).toBe("not_needed");
    expect(remit.control).toBeNull();
    expect(remit.detail).toMatch(/^Scheduled\. Notice filed Nov 1, 2026 · Remit report due Jun 15, 2027 \(UNVERIFIED\)/);
  });

  it("Mar 1, 2027: the runner works the next notice cycle and shows the remit stage as a scheduled line", async () => {
    await jumpTo("2027-03-01");
    const v = await buildRunner(t.db, companyId, "CA");
    expect(v.stageName).toBeNull();
    expect(v.scheduled).toMatchObject({ line: "Notice filed Nov 1, 2026 · Remit report due Jun 15, 2027 (UNVERIFIED)", unverified: true, count: 1, totalCents: 157_410 });
    expect(v.steps.find((s) => s.id === "report_generate")?.control).toMatchObject({ op: "generate_report" });
  });

  it("Jun 1, 2027 onwards: remit report -> file -> Record remittance clears Callum; the next cycle stays To Report", async () => {
    await jumpTo("2027-06-20");
    let v = await buildRunner(t.db, companyId, "CA");
    expect(v.stageName).toBe("remit");
    expect(v.scheduled).toBeNull();
    expect(v.atStakeCents).toBe(157_410);
    const gen = v.steps.find((s) => s.id === "report_generate")!;
    expect(gen.control).toMatchObject({ op: "generate_report", label: "Generate remit report" });
    // The remit report is due on the items' remit date, and it is 5 days late now.
    expect(gen.late).toEqual({ date: "2027-06-15", daysLate: 5 });
    expect(await remittanceOwed(t.db, companyId, "CA")).toBeNull();

    const g = await generateStateReport(t.db, companyId, "CA", { followUp: true, dataDir });
    expect(g.report).toMatchObject({ stage: "remit", itemCount: 1, totalCents: 157_410, reportYear: 2027 });
    v = await buildRunner(t.db, companyId, "CA");
    expect(v.steps.find((s) => s.id === "report_generate")?.tone).not.toBe("machine");

    // Approval freezes the REMIT stage's record; the filing then locks it (the filing agent leaves To Report alone).
    const rec = await draftFilingRecord(t.db, g.report, { approvedBy: "Dana Ruiz", acknowledgedUnverified: null });
    expect(rec).toMatchObject({ stage: "remit", stageRemits: true, nextStage: null, itemCount: 1, reportDue: { date: "2027-06-15", unverified: true }, daysLate: 5, remitDue: { date: "2027-06-15" } });
    await t.db
      .update(reports)
      .set({ status: "submitted", replicaConfirmation: "REPL-CA-2", submittedAt: new Date(), filingRecord: { ...rec, approvedAt: null, approvalId: null } })
      .where(eq(reports.id, g.report.id));

    const owed = await remittanceOwed(t.db, companyId, "CA");
    expect(owed).toMatchObject({ reportId: g.report.id, count: 1, totalCents: 157_410, itemIds: [ids.callum!.staleId], remitDue: "2027-06-15" });
    v = await buildRunner(t.db, companyId, "CA");
    expect(v.steps.find((s) => s.id === "remit")?.control).toMatchObject({ op: "record_remittance", reportId: g.report.id, expectedCount: 1, expectedCents: 157_410 });
    expect(v.receipt).toMatchObject({ reportId: g.report.id, stage: "remit", stageRemits: true, frozen: true });
    // The notice report itself still refuses a remittance.
    await expect(recordRemittance(t.db, { companyId, state: "CA", reportId: noticeId, approvedBy: "Dana Ruiz", remittedOn: "2027-06-20", expectedCount: 1, expectedCents: 157_410 })).rejects.toMatchObject({ code: "notice_only" });

    await recordRemittance(t.db, { companyId, state: "CA", reportId: g.report.id, approvedBy: "Dana Ruiz", remittedOn: "2027-06-20", expectedCount: 1, expectedCents: 157_410 });
    const rows = await t.db.select().from(staleItems);
    expect(rows.find((r) => r.id === ids.callum!.staleId)?.status).toBe("remitted");
    expect(rows.find((r) => r.id === ids.raven!.staleId)?.status).toBe("to_report");
    expect(await loadRemitStage(t.db, companyId, "CA", "2027-06-20")).toBeNull();

    // The runner moves on to the next notice cycle and keeps the remit stage's receipt until that cycle has a report.
    v = await buildRunner(t.db, companyId, "CA");
    expect(v.stageName).toBeNull();
    expect(v.atStakeCents).toBe(219_470);
    expect(v.priorReceipt).toMatchObject({ reportId: g.report.id, stage: "remit", remittance: { totalCents: 157_410, remittedOn: "2027-06-20" } });
  });
});
