import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { reports, staleItems } from "@/db/schema";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { loadEvidenceFiling } from "@/lib/reports/evidence-filing";
import { parseFilingRecord } from "@/lib/reports/filing-record";
import { approveReportFromRunner, RunnerApprovalError } from "./approve-report";
import { loadCloseSnapshot } from "./plan";
import { recordRemittance, remittanceOwed, RemittanceError } from "./remittance";
import { buildRunner } from "./runner";

const ITEMS: FixtureItem[] = [
  { key: "a", check: "91001", payee: "Lone Star Supply", cents: 77_374, issueDate: "2023-01-01", state: "TX", status: "to_report", report: "2026-07-01", remit: "2026-07-01" },
  { key: "z", check: "91009", payee: "Zinnia Court Market", cents: 22_626, issueDate: "2023-01-01", state: "TX", status: "to_report", ddEnd: "2026-06-01", report: "2026-07-01", remit: "2026-07-01" },
  { key: "c", check: "10327", payee: "Callum Whitlock", cents: 157_410, issueDate: "2022-01-01", state: "CA", status: "reported", report: "2026-11-02", remit: "2027-06-15" },
];
const CHECKSUM = "c".repeat(64);

let t: TestDb;
let companyId: string;

async function addReport(state: string, status: string, over: Partial<typeof reports.$inferInsert> = {}): Promise<string> {
  const [r] = await t.db
    .insert(reports)
    .values({ companyId, state, reportYear: 2026, status: status as never, itemCount: 2, totalCents: 100_000, checksum: CHECKSUM, validationErrors: [], ...over })
    .returning();
  return r!.id;
}

/** What the filing agent does after the portal confirms (browser-agents/filing.ts). */
async function file(reportId: string, state: string) {
  await t.db.update(reports).set({ status: "submitted", replicaConfirmation: `REPL-${state}-1`, submittedAt: new Date() }).where(eq(reports.id, reportId));
  await t.db.update(staleItems).set({ status: "reported" }).where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), eq(staleItems.status, "to_report")));
}

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  companyId = (await insertFixture(t.db, ITEMS)).companyId;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("the frozen filing record (R6-01, R6-07, R6-09)", () => {
  it("is written at approval and survives the remittance: receipt and evidence pack keep the late filing", async () => {
    const reportId = await addReport("TX", "validated", { stage: "annual" });
    const unverified = (await loadCloseSnapshot(t.db, companyId, "TX")).unverifiedRulePaths.length;
    expect(unverified).toBeGreaterThan(0);
    const base = { companyId, state: "TX", reportId, approvedBy: "Dogfood Controller", expectedChecksum: CHECKSUM };

    // R6-09: Zinnia's window closed with no letter: the approval must acknowledge it, exactly like unverified rules.
    await expect(approveReportFromRunner(t.db, { ...base, acknowledgedUnverified: unverified })).rejects.toBeInstanceOf(RunnerApprovalError);
    await approveReportFromRunner(t.db, { ...base, acknowledgedUnverified: unverified, acknowledgedUnsent: 1, signIn: "none_configured" });

    const [row] = await t.db.select().from(reports).where(eq(reports.id, reportId));
    const rec = parseFilingRecord(row!.filingRecord);
    expect(rec).toMatchObject({
      asOf: "2026-11-01",
      reportDue: { date: "2026-07-01" },
      daysLate: 123,
      unverifiedRuleCount: unverified,
      unverifiedAcknowledged: true,
      unsentAcknowledged: true,
      approvedBy: "Dogfood Controller",
      stage: "annual",
      stageRemits: true,
      signIn: "none_configured",
    });
    expect(rec!.unsentNotices).toEqual([expect.objectContaining({ payeeName: "ZINNIA COURT MARKET", amountCents: 22_626, reason: "no letter was drafted" })]);

    await file(reportId, "TX");
    const before = (await buildRunner(t.db, companyId, "TX")).receipt!;
    expect(before).toMatchObject({ frozen: true, daysLate: 123, unverifiedRuleCount: unverified, reportDue: "2026-07-01" });

    await recordRemittance(t.db, { companyId, state: "TX", reportId, approvedBy: "Dogfood Controller", remittedOn: "2026-11-01", reference: "WIRE-DF6-TX", expectedCount: 2, expectedCents: 100_000 });
    const view = await buildRunner(t.db, companyId, "TX");
    const after = view.receipt!;
    // Every filing fact is unchanged; only the remittance was added.
    expect({ ...after, remittance: null }).toEqual({ ...before, remittance: null });
    expect(after.remittance).toMatchObject({ reference: "WIRE-DF6-TX", by: "Dogfood Controller", totalCents: 100_000 });
    expect(view.atStakeCents).toBe(0);
    expect(view.remittedCents).toBe(100_000);
    expect(view.steps.find((s) => s.id === "rules_verify")?.detail).not.toMatch(/is verified/);
    expect(view.steps.find((s) => s.id === "letters_send")?.tone).toBe("missed");

    const [filed] = await t.db.select().from(reports).where(eq(reports.id, reportId));
    expect(filed!.filingRecord).toEqual(row!.filingRecord);
    const pack = await loadEvidenceFiling(t.db, filed!);
    expect(pack).toMatchObject({ daysLate: 123, reportDue: { date: "2026-07-01" }, unverifiedRuleCount: unverified, unverifiedAcknowledged: true, approvedBy: "Dogfood Controller" });
    expect(pack?.unsentNotices).toHaveLength(1);
    expect(pack?.remittance).toMatchObject({ reference: "WIRE-DF6-TX" });
  });
});

describe("CA two-stage cycle (R6-02)", () => {
  it("a notice-only filing owes no remittance, refuses one, and the runner shows the remit report date from the rules", async () => {
    const reportId = await addReport("CA", "submitted", { stage: "notice", itemCount: 1, totalCents: 157_410, replicaConfirmation: "REPL-CA-1", submittedAt: new Date() });
    expect(await remittanceOwed(t.db, companyId, "CA")).toBeNull();
    const err = await recordRemittance(t.db, { companyId, state: "CA", reportId, approvedBy: "Dogfood Controller", remittedOn: "2026-11-01", expectedCount: 1, expectedCents: 157_410 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemittanceError);
    expect((err as RemittanceError).code).toBe("notice_only");
    const [item] = await t.db.select().from(staleItems).where(eq(staleItems.ownerState, "CA"));
    expect(item!.status).toBe("reported");

    const v = await buildRunner(t.db, companyId, "CA");
    const remit = v.steps.find((s) => s.id === "remit")!;
    expect(remit.control).toBeNull();
    expect(remit.detail).toMatch(/Remit report due Jun 15, 2027 \(UNVERIFIED\)/);
    // Not remitted money is still at stake.
    expect(v.atStakeCents).toBe(157_410);
  });
});
