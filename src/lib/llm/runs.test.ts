import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { finishRun, startRun } from "./runs";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

describe("startRun / finishRun replay logging", () => {
  it("stores mode replay in the input and a zero billed cost", async () => {
    const id = await startRun(t.db, { agent: "chat", model: "claude-opus-5-5", mode: "replay", input: { request: {} } });
    await finishRun(t.db, id, { status: "succeeded", model: "claude-opus-5-5", trace: [], inputTokens: 15333, outputTokens: 448, costUsdMicros: 0 });
    const [row] = await t.db.select().from(agentRuns).where(eq(agentRuns.id, id!));
    expect(row!.input).toMatchObject({ mode: "replay" });
    expect(row!.costUsdMicros).toBe(0);
    expect(row!.inputTokens).toBe(15333);
  });

  it("leaves live runs unmarked", async () => {
    const id = await startRun(t.db, { agent: "chat", model: "m", input: {} });
    const [row] = await t.db.select().from(agentRuns).where(eq(agentRuns.id, id!));
    expect(row!.input).not.toHaveProperty("mode");
  });
});
