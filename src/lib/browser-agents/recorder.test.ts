import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { ARTIFACTS_ROOT, RunRecorder, usageCostMicros } from "./recorder";

describe("usageCostMicros", () => {
  it("is exactly zero for scripted runs (no model called)", () => {
    expect(usageCostMicros({ model: null, inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
  it("prices live Stagehand usage, stripping the provider prefix", () => {
    // sonnet-5-5: $2/M in, $10/M out => 1000*2 + 500*10 micros
    expect(usageCostMicros({ model: "anthropic/claude-sonnet-5-5", inputTokens: 1000, outputTokens: 500 })).toBe(7000);
  });
  it("is null (never a guess) for an unpriced model", () => {
    expect(usageCostMicros({ model: "mystery-model", inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});

/** A fake Db whose `update(...).set(v).where(...)` records `v` once `open()` is called (a busy database until then). */
function fakeDb() {
  const writes: Record<string, unknown>[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const db = {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          await gate;
          writes.push(v);
        },
      }),
    }),
  } as unknown as Db;
  return { db, writes, open };
}

const runIds: string[] = [];
const runId = (tag: string) => {
  const id = `test-r901-${tag}-${process.pid}`;
  runIds.push(id);
  return id;
};
afterAll(() => {
  for (const id of runIds) rmSync(path.join(ARTIFACTS_ROOT, id), { recursive: true, force: true });
});

// R9-01: a busy database slows the run trace, never the browser steps; and the run can always settle and free its slot.
describe("RunRecorder write waits", () => {
  it("does not hold an agent step on a stuck trace write, and the writes still land in order afterwards", async () => {
    const { db, writes, open } = fakeDb();
    const rec = new RunRecorder(db, runId("stuck"), undefined, { writeWaitMs: 20 });
    const started = Date.now();
    await rec.step("info", "one");
    await rec.step("action", "two");
    await rec.finish("failed", "portal timeout");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(writes).toHaveLength(0); // still queued behind the busy database

    open();
    await rec.flush();
    expect(writes.map((w) => (w.trace as unknown[]).length)).toEqual([1, 2, 2, 2]);
    // The run row's status lands after every trace write queued before it; the later flush does not touch it.
    expect(writes[2]).toMatchObject({ status: "failed", error: "portal timeout" });
    expect(writes[3]).not.toHaveProperty("status");
  });

  it("waits for the write when the database answers in time", async () => {
    const { db, writes, open } = fakeDb();
    open();
    const rec = new RunRecorder(db, runId("fast"), undefined, { writeWaitMs: 1_000 });
    await rec.step("info", "one");
    expect(writes).toHaveLength(1);
  });

  it("gives screenshots their own short time limit", async () => {
    const { db, open } = fakeDb();
    open();
    const rec = new RunRecorder(db, runId("shot"), undefined, { shotMs: 1234 });
    const seen: unknown[] = [];
    const entry = await rec.step("action", "shot", { page: { screenshot: async (o) => void seen.push(o.timeout) }, shotName: "x" });
    expect(seen).toEqual([1234]);
    expect(entry.screenshot).toMatch(/01-x\.png$/);
  });
});
