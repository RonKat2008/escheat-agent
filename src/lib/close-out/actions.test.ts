import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, companies, outreach, reports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TEST_SECRET } from "@/lib/outreach/testing";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { runCloseStep } from "./actions";

const ITEMS: FixtureItem[] = [
  { key: "p1", check: "81001", payee: "Bayline Electric", cents: 100_000, issueDate: "2025-01-01", state: "CA", status: "dd_pending", ddStart: "2026-10-01", ddEnd: "2026-12-01", report: "2027-06-30" },
  { key: "p2", check: "81002", payee: "Coastal Paper", cents: 20_000, issueDate: "2025-01-02", state: "CA", status: "dd_pending", ddStart: "2026-10-01", ddEnd: "2026-12-15", report: "2027-06-30" },
  { key: "r1", check: "81004", payee: "Sierra Lumber", cents: 30_000, issueDate: "2024-01-01", state: "CA", status: "to_report", report: "2026-11-30", remit: "2026-11-30", ruleVersion: null },
];

let t: TestDb;
let companyId: string;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("OWNER_LINK_SECRET", TEST_SECRET);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  t = await createTestDb();
  companyId = (await insertFixture(t.db, ITEMS)).companyId;
  // The holder needs an address for a valid NAUPA file.
  await t.db.update(companies).set({ addressLine: "100 Congress Ave", city: "Austin", zip: "78701" }).where(eq(companies.id, companyId));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("runCloseStep", () => {
  it("drafts the letters the plan asked for, approves and sends nothing, and returns the updated plan", async () => {
    const r = await runCloseStep(t.db, companyId, "CA", "letters_draft");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toMatch(/^Drafted 2 letters\. .*nothing was sent\.$/);
    const rows = await t.db.select().from(outreach);
    expect(rows).toHaveLength(2);
    expect(rows.every((o) => o.channel === "letter" && o.approvalId === null && o.sentAt === null)).toBe(true);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
    expect(r.plan.steps.find((s) => s.id === "letters_draft")?.status).toBe("done");
    expect(r.plan.steps.find((s) => s.id === "letters_approve")?.status).toMatch(/needs_approval|blocked/);
  });

  it("drafting twice is a no-op the second time (the step is done, so it is refused)", async () => {
    await runCloseStep(t.db, companyId, "CA", "letters_draft");
    const again = await runCloseStep(t.db, companyId, "CA", "letters_draft");
    expect(again.ok).toBe(false);
    expect(await t.db.select().from(outreach)).toHaveLength(2);
  });

  it("generates and validates the report through the guarded chat tool, filing nothing", async () => {
    const r = await runCloseStep(t.db, companyId, "CA", "report_generate");
    const [row] = await t.db.select().from(reports);
    expect(row).toBeDefined();
    expect(["validated", "draft"]).toContain(row!.status);
    expect(row!.submittedAt).toBeNull();
    if (r.ok) expect(r.message).toMatch(/nothing was filed\.$/);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });

  it("refuses every irreversible step, whatever the client asks for", async () => {
    for (const id of ["letters_approve", "letters_send", "rules_verify", "report_approve", "report_submit", "remit"] as const) {
      const r = await runCloseStep(t.db, companyId, "CA", id);
      expect(r, id).toMatchObject({ ok: false, error: expect.stringMatching(/needs your action at its gate/) });
    }
    expect(await t.db.select().from(outreach)).toHaveLength(0);
    expect(await t.db.select().from(reports)).toHaveLength(0);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });

  it("never regenerates a report a person already holds", async () => {
    await t.db.insert(reports).values({ companyId, state: "CA", reportYear: 2026, status: "awaiting_approval", itemCount: 1, totalCents: 30_000, checksum: "abc" });
    const r = await runCloseStep(t.db, companyId, "CA", "report_generate");
    expect(r.ok).toBe(false);
    const rows = await t.db.select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("awaiting_approval");
  });
});
