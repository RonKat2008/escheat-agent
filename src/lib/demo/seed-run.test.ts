import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { companies } from "@/db/schema";
import { listAgentRuns } from "@/lib/queries";
import { demoInvariantProblems } from "./expected";
import { recordSeedDryRun } from "./seed-run";

describe("recordSeedDryRun", () => {
  it("writes one succeeded, scripted, unbilled filing run that says nothing was filed", async () => {
    const t = await createTestDb();
    try {
      const [co] = await t.db.insert(companies).values({ name: "Synthetic Co", incorporationState: "DE", hqState: "CA", isSynthetic: true }).returning();
      await recordSeedDryRun(t.db, co!.id, {
        rules: [{ state: "TX", version: "2026.1", verified: false }],
        items: 47,
        totalCents: 6_191_500,
        byState: { CA: 21, TX: 15, DE: 11 },
      });
      const rows = await listAgentRuns(t.db, co!.id, { includeReplays: false });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ agent: "filing_agent", status: "succeeded", model: "scripted" });
      expect(rows[0]!.input).toMatchObject({ mode: "scripted", dryRun: true });
      expect(JSON.stringify(rows[0]!.trace)).toMatch(/nothing filed/);
      expect(JSON.stringify(rows[0]!.trace)).toMatch(/UNVERIFIED/);
      // R8-12: both timestamps come from the one JS clock, so the duration is never negative.
      expect(rows[0]!.finishedAt!.getTime() - rows[0]!.startedAt.getTime()).toBeGreaterThanOrEqual(0);
    } finally {
      await t.close();
    }
  });
});

describe("demoInvariantProblems", () => {
  it("is empty for the seed numbers", () => {
    expect(demoInvariantProblems({ items: 47, totalCents: 6_191_500, byState: { CA: 21, TX: 15, DE: 11 } })).toEqual([]);
  });
});
