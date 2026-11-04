import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach, reports } from "@/db/schema";
import { outreachContentSha256 } from "@/lib/outreach/util";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { buildRunner, loadRunnerFacts } from "./runner";

const ITEMS: FixtureItem[] = [
  { key: "p1", check: "81001", payee: "Bayline Electric", cents: 100_000, issueDate: "2025-01-01", state: "TX", status: "dd_pending", ddStart: "2026-10-01", ddEnd: "2026-12-01", report: "2027-07-01", remit: "2027-07-01" },
  { key: "r1", check: "81002", payee: "Lone Star Supply", cents: 77_374, issueDate: "2023-01-01", state: "TX", status: "to_report", report: "2026-07-01", remit: "2026-07-01" },
];

let t: TestDb;
let companyId: string;
let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  const f = await insertFixture(t.db, ITEMS);
  companyId = f.companyId;
  ids = f.ids;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("close-out runner loader", () => {
  it("reads letter drafts with their reviewed hash and compose state", async () => {
    const [row] = await t.db
      .insert(outreach)
      .values({ companyId, staleItemId: ids.p1!.staleId, channel: "letter", status: "draft", body: "Dear owner", tracking: { compose: { readiness: { ready: true, problems: [] } } } })
      .returning();
    const f = await loadRunnerFacts(t.db, companyId, "tx");
    expect(f.letters).toEqual([
      {
        outreachId: row!.id,
        staleItemId: ids.p1!.staleId,
        status: "draft",
        composed: true,
        ready: true,
        problems: [],
        contentSha256: outreachContentSha256(row!),
        payeeName: "BAYLINE ELECTRIC",
        checkNumber: "81001",
        amountCents: 100_000,
      },
    ]);
    expect(f.ddItemCount).toBe(1);
  });

  it("R5-03: a sent letter is listed with its real outcome (offline), and the send mode follows the env", async () => {
    vi.stubEnv("ESCHEAT_OFFLINE", "1");
    await t.db.insert(outreach).values({ companyId, staleItemId: ids.p1!.staleId, channel: "letter", status: "sent", offline: true, body: "Dear owner" });
    const f = await loadRunnerFacts(t.db, companyId, "TX");
    expect(f.sent).toEqual([{ outreachId: expect.any(String), payeeName: "BAYLINE ELECTRIC", amountCents: 100_000, offline: true }]);
    expect(f.letters).toEqual([]);
    expect(f.sendMode).toBe("offline");
  });

  it("computes lateness from the engine's report due date and interest from the shared late-money helper", async () => {
    const f = await loadRunnerFacts(t.db, companyId, "TX");
    expect(f.late.reportDue).toBe("2026-07-01");
    expect(f.late.daysLate).toBe(123);
    // Never a guessed rate: either the rules engine's figure, or an honest UNKNOWN with a reason.
    expect(["ok", "unknown"]).toContain(f.late.interest.status);
    if (f.late.interest.status === "ok") expect(f.late.interest.cents).toBeGreaterThan(0);
  });

  it("names the approver of the report from the approval row and builds a receipt once submitted", async () => {
    const [a] = await t.db.insert(approvals).values({ action: "submit_report", subjectId: "x", payloadSha256: "c".repeat(64), approvedBy: "Dana Ruiz", approvedAt: new Date() }).returning();
    await t.db.insert(reports).values({
      companyId,
      state: "TX",
      reportYear: 2026,
      status: "submitted",
      itemCount: 1,
      totalCents: 77_374,
      checksum: "c".repeat(64),
      validationErrors: [],
      approvalId: a!.id,
      replicaConfirmation: "REPL-TX-42",
      submittedAt: new Date("2026-11-03T10:00:00Z"),
    });
    const v = await buildRunner(t.db, companyId, "TX");
    expect(v.receipt).toMatchObject({ confirmation: "REPL-TX-42", itemCount: 1, totalCents: 77_374, approvedBy: "Dana Ruiz" });
    expect(v.steps.find((s) => s.id === "report_submit")?.tone).toBe("done");
  });

  it("refuses an unsupported state", async () => {
    await expect(loadRunnerFacts(t.db, companyId, "NY")).rejects.toThrow(/CA, DE and TX/);
  });
});
