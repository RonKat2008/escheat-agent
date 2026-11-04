import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { countAgentRuns, countAgentRunsByStatus, listAgentRunAgents, listAgentRuns } from "./runs";
import { insertFixture, STANDARD_ITEMS } from "./test-fixtures";

let t: TestDb;
let companyId: string;
const T0 = Date.parse("2026-11-01T12:00:00Z");

type Seed = { agent: string; status: "running" | "succeeded" | "failed" | "cancelled"; replay?: boolean };
async function seed(rows: Seed[]) {
  // Row i is i seconds newer than row i-1, so the last row is the newest.
  await t.db.insert(agentRuns).values(
    rows.map((r, i) => ({
      companyId,
      agent: r.agent,
      status: r.status,
      input: r.replay ? { mode: "replay" } : {},
      startedAt: new Date(T0 + i * 1000),
    })),
  );
}

beforeEach(async () => {
  t = await createTestDb();
  ({ companyId } = await insertFixture(t.db, STANDARD_ITEMS));
});
afterEach(async () => {
  await t.close();
});

describe("agent runs query (R6-06)", () => {
  it("finds old chat runs behind 230 newer classifier runs, in SQL", async () => {
    await seed([
      ...Array.from({ length: 8 }, () => ({ agent: "chat", status: "succeeded" as const })),
      { agent: "filing_agent", status: "succeeded" },
      ...Array.from({ length: 230 }, () => ({ agent: "classifier", status: "succeeded" as const })),
    ]);
    const chat = await listAgentRuns(t.db, companyId, { agent: "chat", limit: 40 });
    expect(chat).toHaveLength(8);
    expect(chat.every((r) => r.agent === "chat")).toBe(true);
    expect(await countAgentRuns(t.db, companyId, { agent: "chat" })).toBe(8);
    expect(await listAgentRunAgents(t.db, companyId)).toEqual(["chat", "classifier", "filing_agent"]);
    expect((await countAgentRunsByStatus(t.db, companyId)).succeeded).toBe(239);
  });

  it("pages newest first with limit/offset and no overlap", async () => {
    await seed(Array.from({ length: 230 }, () => ({ agent: "classifier", status: "succeeded" as const })));
    const p1 = await listAgentRuns(t.db, companyId, { limit: 40, offset: 0 });
    const p2 = await listAgentRuns(t.db, companyId, { limit: 40, offset: 40 });
    const last = await listAgentRuns(t.db, companyId, { limit: 40, offset: 200 });
    expect(p1).toHaveLength(40);
    expect(p2).toHaveLength(40);
    expect(last).toHaveLength(30);
    expect(new Set([...p1, ...p2].map((r) => r.id)).size).toBe(80);
    expect(p1[0]!.startedAt.getTime()).toBeGreaterThan(p1[39]!.startedAt.getTime());
    expect(p1[39]!.startedAt.getTime()).toBeGreaterThan(p2[0]!.startedAt.getTime());
  });

  it("filters by status in SQL across more than 200 rows", async () => {
    await seed([
      { agent: "recovery_agent", status: "failed" },
      ...Array.from({ length: 210 }, () => ({ agent: "classifier", status: "succeeded" as const })),
    ]);
    const failed = await listAgentRuns(t.db, companyId, { status: "failed" });
    expect(failed.map((r) => r.agent)).toEqual(["recovery_agent"]);
    expect(await countAgentRuns(t.db, companyId, { status: "succeeded" })).toBe(210);
  });
});

describe("skipped offline replays (R6-19)", () => {
  const rows: Seed[] = [
    { agent: "classifier", status: "cancelled", replay: true },
    { agent: "classifier", status: "cancelled", replay: true },
    { agent: "chat", status: "cancelled" },
    { agent: "chat", status: "succeeded", replay: true },
  ];

  it("hides them when asked, keeps real cancellations and full replays", async () => {
    await seed(rows);
    expect(await countAgentRuns(t.db, companyId, { includeReplays: false })).toBe(2);
    expect(await countAgentRuns(t.db, companyId)).toBe(4);
  });

  it("'replayed' is one status: the chip count equals the rows shown, and 'cancelled' excludes them", async () => {
    await seed(rows);
    const counts = await countAgentRunsByStatus(t.db, companyId);
    expect(counts).toEqual({ running: 0, succeeded: 1, failed: 0, cancelled: 1, replayed: 2 });
    const replayed = await listAgentRuns(t.db, companyId, { status: "replayed", includeReplays: false });
    expect(replayed).toHaveLength(counts.replayed);
    expect(await countAgentRuns(t.db, companyId, { status: "cancelled" })).toBe(counts.cancelled);
    expect((await countAgentRunsByStatus(t.db, companyId, "chat")).replayed).toBe(0);
  });

  it("keeps an agent chip even when all of its runs are hidden replays", async () => {
    await seed(rows.slice(0, 2));
    expect(await listAgentRuns(t.db, companyId, { includeReplays: false })).toHaveLength(0);
    expect(await listAgentRunAgents(t.db, companyId)).toEqual(["classifier"]);
  });
});
