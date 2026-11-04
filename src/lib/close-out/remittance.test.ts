import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, reports, staleItems } from "@/db/schema";
import { getOverdue } from "@/lib/queries";
import { getNeedsActionIds } from "@/lib/queries/needs-action";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { acknowledgementCovers, approveReportFromRunner, RunnerApprovalError } from "./approve-report";
import { loadRemittance, recordRemittance, remittanceOwed, RemittanceError } from "./remittance";
import { buildRunner } from "./runner";

const ITEMS: FixtureItem[] = [
  { key: "a", check: "91001", payee: "Lone Star Supply", cents: 77_374, issueDate: "2023-01-01", state: "TX", status: "reported", report: "2026-07-01", remit: "2026-07-01" },
  { key: "b", check: "91002", payee: "Rushmere Freight", cents: 22_626, issueDate: "2023-01-01", state: "TX", status: "reported", report: "2026-07-01", remit: "2026-07-01" },
  { key: "c", check: "91003", payee: "Other State Co", cents: 5_000, issueDate: "2023-01-01", state: "CA", status: "reported", report: "2026-07-01", remit: "2026-07-01" },
];

let t: TestDb;
let companyId: string;
let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];
let reportId: string;

async function addReport(status: string, over: Partial<typeof reports.$inferInsert> = {}): Promise<string> {
  const [r] = await t.db
    .insert(reports)
    .values({ companyId, state: "TX", reportYear: 2026, status: status as never, itemCount: 2, totalCents: 100_000, checksum: "c".repeat(64), validationErrors: [], ...over })
    .returning();
  return r!.id;
}

const input = (over: Partial<Parameters<typeof recordRemittance>[1]> = {}) => ({
  companyId,
  state: "TX",
  reportId,
  approvedBy: "Dana Ruiz",
  remittedOn: "2026-11-01",
  reference: "WIRE-42",
  expectedCount: 2,
  expectedCents: 100_000,
  ...over,
});

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  const f = await insertFixture(t.db, ITEMS);
  companyId = f.companyId;
  ids = f.ids;
  reportId = await addReport("submitted", { replicaConfirmation: "REPL-TX-1", submittedAt: new Date("2026-11-01T10:00:00Z") });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("record remittance (R5-05)", () => {
  it("before: the reported items are overdue on their remit date", async () => {
    const o = await getOverdue(t.db, companyId, { states: ["TX"] });
    expect(o.items.filter((i) => i.overdue.some((x) => x.kind === "remit_due"))).toHaveLength(2);
    const needs = await getNeedsActionIds(t.db, companyId);
    expect(needs.has(ids.a!.staleId) && needs.has(ids.b!.staleId)).toBe(true);
    expect(await remittanceOwed(t.db, companyId, "TX")).toMatchObject({ reportId, count: 2, totalCents: 100_000, remitDue: "2026-07-01" });
  });

  it("moves exactly the state's reported items to remitted under a consumed approval; overdue and the runner follow", async () => {
    const res = await recordRemittance(t.db, input());
    expect(res).toMatchObject({ state: "TX", itemCount: 2, totalCents: 100_000, remittedOn: "2026-11-01", reference: "WIRE-42", by: "Dana Ruiz" });
    const rows = await t.db.select().from(staleItems);
    expect(rows.filter((r) => r.status === "remitted").map((r) => r.id).sort()).toEqual([ids.a!.staleId, ids.b!.staleId].sort());
    expect(rows.find((r) => r.id === ids.c!.staleId)?.status).toBe("reported"); // other state untouched
    const [a] = await t.db.select().from(approvals).where(eq(approvals.subjectId, `remit:${reportId}`));
    expect(a).toMatchObject({ action: "submit_report", approvedBy: "Dana Ruiz" });
    expect(a!.consumedAt).not.toBeNull();

    const o = await getOverdue(t.db, companyId, { states: ["TX"] });
    expect(o.items).toHaveLength(0);
    // R5 numbers: remitted items leave the Late band and Needs action (the CA item, still unremitted, stays).
    const needs = await getNeedsActionIds(t.db, companyId);
    expect(needs.has(ids.a!.staleId) || needs.has(ids.b!.staleId)).toBe(false);
    expect(needs.has(ids.c!.staleId)).toBe(true);
    expect(await loadRemittance(t.db, companyId, "TX", reportId)).toEqual({ remittedOn: "2026-11-01", reference: "WIRE-42", by: "Dana Ruiz", itemCount: 2, totalCents: 100_000 });
    const v = await buildRunner(t.db, companyId, "TX");
    const remit = v.steps.find((s) => s.id === "remit")!;
    expect(remit.tone).toBe("done");
    expect(remit.late).toBeNull();
    expect(v.receipt?.remittance?.reference).toBe("WIRE-42");
    // R8-17: a second record is refused as "already remitted", with what was recorded and a link, not "file the report first".
    const second = recordRemittance(t.db, input());
    await expect(second).rejects.toMatchObject({
      code: "already_remitted",
      status: 409,
      message: "Already remitted $1,000.00 for 2 items on Nov 1, 2026 (ref WIRE-42). Nothing new was recorded.",
      href: "/close-out/TX",
    });
  });

  it("the runner offers it as a human step bound to the items and total", async () => {
    const v = await buildRunner(t.db, companyId, "TX");
    expect(v.steps.find((s) => s.id === "remit")?.control).toMatchObject({ op: "record_remittance", reportId, expectedCount: 2, expectedCents: 100_000, defaultDate: "2026-11-01" });
  });

  it("refuses without a name, with a future or malformed date, a stale amount, or before the report is filed", async () => {
    await expect(recordRemittance(t.db, input({ approvedBy: "  " }))).rejects.toMatchObject({ code: "no_approver" });
    await expect(recordRemittance(t.db, input({ approvedBy: "X" }))).rejects.toMatchObject({ code: "no_approver" });
    await expect(recordRemittance(t.db, input({ remittedOn: "2026-11-02" }))).rejects.toMatchObject({ code: "future_date" });
    await expect(recordRemittance(t.db, input({ remittedOn: "Nov 1" }))).rejects.toMatchObject({ code: "bad_date" });
    await expect(recordRemittance(t.db, input({ expectedCents: 99_999 }))).rejects.toMatchObject({
      code: "amount_mismatch",
      message: "The amount does not match the filed report: you entered $999.99, the report is $1,000.00 for 2 items.",
    });
    await expect(recordRemittance(t.db, input({ expectedCount: 3 }))).rejects.toMatchObject({ code: "changed" });
    await expect(recordRemittance(t.db, input({ reference: "x".repeat(81) }))).rejects.toBeInstanceOf(RemittanceError);
    await t.db.update(reports).set({ status: "approved" }).where(eq(reports.id, reportId));
    await expect(recordRemittance(t.db, input())).rejects.toMatchObject({ code: "nothing_owed" });
    expect((await t.db.select().from(staleItems)).filter((r) => r.status === "remitted")).toHaveLength(0);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });
});

describe("runner report approval needs 'approve anyway' for unverified rules (R5-04)", () => {
  it("acknowledgementCovers needs the exact live count, and none when everything is verified", () => {
    expect(acknowledgementCovers(0, null)).toBe(true);
    expect(acknowledgementCovers(3, 3)).toBe(true);
    expect(acknowledgementCovers(3, null)).toBe(false);
    expect(acknowledgementCovers(3, 2)).toBe(false);
  });

  it("refuses an unacknowledged approval and approves an acknowledged one (checksum still bound)", async () => {
    await t.db.update(staleItems).set({ status: "to_report" }).where(eq(staleItems.ownerState, "TX"));
    await t.db.delete(reports);
    const id = await addReport("validated");
    const base = { companyId, state: "TX", reportId: id, approvedBy: "Dana Ruiz", expectedChecksum: "c".repeat(64) };
    const v = await buildRunner(t.db, companyId, "TX");
    const ctl = v.steps.find((s) => s.id === "report_approve")!.control;
    const u = ctl?.op === "approve_report" ? ctl.unverifiedCount : -1;
    expect(u).toBeGreaterThan(0); // the TX rule file still has UNVERIFIED values
    expect(ctl).toMatchObject({ label: "Approve anyway", file: { checksum: "c".repeat(64), fileHref: `/api/reports/${id}/file` } });

    await expect(approveReportFromRunner(t.db, base)).rejects.toBeInstanceOf(RunnerApprovalError);
    await expect(approveReportFromRunner(t.db, { ...base, acknowledgedUnverified: u - 1 })).rejects.toMatchObject({ code: "unverified_not_acknowledged" });
    await expect(approveReportFromRunner(t.db, { ...base, reportId: "00000000-0000-4000-8000-000000000000", acknowledgedUnverified: u })).rejects.toMatchObject({ code: "not_this_report" });
    expect(await t.db.select().from(approvals)).toHaveLength(0);
    await expect(approveReportFromRunner(t.db, { ...base, expectedChecksum: "0".repeat(64), acknowledgedUnverified: u })).rejects.toThrow();

    const ok = await approveReportFromRunner(t.db, { ...base, acknowledgedUnverified: u });
    expect(ok.report.status).toBe("approved");
    expect(ok.unverifiedAcknowledged).toBe(u);
  });
});
