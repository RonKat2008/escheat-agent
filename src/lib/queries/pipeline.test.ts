import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach, recoveries, reports, ruleChanges } from "@/db/schema";
import { seedItem } from "@/lib/outreach/testing";
import { countWaiting } from "@/app/(app)/approvals/queue-count";
import { GATE_COLUMN, getPipeline, PIPELINE_COLUMNS, type Pipeline } from "./pipeline";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

const lane = (p: Pipeline, id: string) => p.lanes.find((l) => l.id === id)!;
const node = (p: Pipeline, id: string, status: string) => {
  const l = lane(p, id);
  return [...l.stages, ...l.offRamp].find((s) => s?.status === status)!;
};

describe("getPipeline", () => {
  it("is empty but complete for a company with nothing in flight", async () => {
    const { company } = await seedItem(t.db);
    const p = await getPipeline(t.db, company.id);
    expect(p.lanes.map((l) => l.id)).toEqual(["outreach", "reports", "recoveries"]);
    for (const l of p.lanes) {
      expect(l.stages).toHaveLength(PIPELINE_COLUMNS);
      expect(l.stages[GATE_COLUMN]?.status).toBe("awaiting_approval");
      expect(l.stages[GATE_COLUMN]?.gate).toBe(true);
      expect(l.stages.every((s) => s === null || s.count === 0)).toBe(true);
      expect(l.waiting).toBe(0);
    }
    expect(p.gateTotal).toBe(0);
  });

  it("counts and sums real rows per status, and the gate equals countWaiting (the nav badge)", async () => {
    const { company, stale } = await seedItem(t.db, { amountCents: 1000 });
    const base = { companyId: company.id, staleItemId: stale.id, channel: "letter" as const };
    await t.db.insert(outreach).values([
      { ...base, status: "draft" },
      { ...base, channel: "email", status: "draft" },
      { ...base, status: "awaiting_approval" },
      { ...base, status: "approved" },
      { ...base, status: "sent", offline: true },
      { ...base, status: "failed" },
      { ...base, status: "cancelled" },
    ]);
    await t.db.insert(reports).values([
      { companyId: company.id, state: "CA", reportYear: 2026, status: "validated", totalCents: 500 },
      { companyId: company.id, state: "TX", reportYear: 2026, status: "approved", totalCents: 700 },
    ]);
    const [ap] = await t.db.insert(approvals).values({ action: "file_claim", subjectId: "x", payloadSha256: "0".repeat(64) }).returning();
    await t.db.insert(recoveries).values([
      { companyId: company.id, state: "CA", amountCents: 300, status: "found" },
      { companyId: company.id, state: "DE", amountCents: 900, status: "awaiting_approval", approvalId: ap!.id },
      { companyId: company.id, state: "TX", amountCents: 50, status: "paid" },
    ]);
    await t.db.insert(ruleChanges).values([{ state: "DE", diff: {}, status: "proposed" }]);

    const p = await getPipeline(t.db, company.id);
    expect(node(p, "outreach", "draft")).toMatchObject({ count: 2, cents: 2000 });
    expect(node(p, "outreach", "awaiting_approval")).toMatchObject({ count: 1, cents: 1000 });
    expect(node(p, "outreach", "sent").count).toBe(1);
    expect(node(p, "outreach", "delivered").count).toBe(0);
    expect(node(p, "outreach", "failed").count).toBe(1);
    expect(node(p, "outreach", "cancelled").count).toBe(1);
    expect(node(p, "reports", "validated")).toMatchObject({ count: 1, cents: 500 });
    expect(node(p, "reports", "approved")).toMatchObject({ count: 1, cents: 700 });
    expect(node(p, "recoveries", "paid")).toMatchObject({ count: 1, cents: 50 });

    // Waiting: outreach draft x2 + awaiting + approved + failed; report validated; recovery found (the approved claim is past the gate).
    expect(lane(p, "outreach").waiting).toBe(5);
    expect(lane(p, "reports").waiting).toBe(1);
    expect(lane(p, "recoveries")).toMatchObject({ waiting: 1, waitingCents: 300 });
    expect(p.ruleChanges).toBe(1);
    expect(p.gateTotal).toBe(8);
    expect(p.gateTotal).toBe(await countWaiting(t.db, company.id));
  });

  it("only counts the company's own rows", async () => {
    const a = await seedItem(t.db);
    const b = await seedItem(t.db, { ref: "999" });
    await t.db.insert(outreach).values({ companyId: b.company.id, staleItemId: b.stale.id, channel: "letter", status: "draft" });
    const p = await getPipeline(t.db, a.company.id);
    expect(node(p, "outreach", "draft").count).toBe(0);
    expect(p.gateTotal).toBe(0);
  });
});
