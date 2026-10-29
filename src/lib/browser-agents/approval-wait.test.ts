import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import type { Approval } from "@/db/schema";
import { ApprovalRequiredError, approve, assertApproved, withApproval } from "@/lib/approvals";
import { ApprovalTimeoutError, waitForApproval } from "./approval-wait";

const approval = { id: "a1" } as Approval;

/** Fake clock: sleep advances time, so no real waiting. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("waitForApproval", () => {
  it("does not release before approval and releases when a matching approval appears", async () => {
    const c = clock();
    let polls = 0;
    const check = vi.fn(async () => {
      if (++polls < 4) throw new ApprovalRequiredError("submit_report", "r1", "none");
      return approval;
    });
    const out = await waitForApproval({ check, intervalMs: 2000, timeoutMs: 60_000, ...c });
    expect(out).toBe(approval);
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("keeps waiting when the approval is for a different checksum", async () => {
    const c = clock();
    const reasons: string[] = [];
    let polls = 0;
    const out = await waitForApproval({
      check: async () => {
        if (++polls < 3) throw new ApprovalRequiredError("submit_report", "r1", "payload_changed");
        return approval;
      },
      intervalMs: 2000,
      timeoutMs: 60_000,
      onWaiting: (i) => reasons.push(i.reason),
      ...c,
    });
    expect(out).toBe(approval);
    expect(reasons).toEqual(["payload_changed", "payload_changed"]);
  });

  it("times out instead of waiting forever", async () => {
    const c = clock();
    await expect(
      waitForApproval({ check: async () => { throw new ApprovalRequiredError("submit_report", "r1", "none"); }, intervalMs: 2000, timeoutMs: 10_000, ...c }),
    ).rejects.toBeInstanceOf(ApprovalTimeoutError);
  });

  it("treats a consumed approval as terminal and rethrows unexpected errors", async () => {
    const c = clock();
    await expect(waitForApproval({ check: async () => { throw new ApprovalRequiredError("submit_report", "r1", "consumed"); }, ...c })).rejects.toBeInstanceOf(ApprovalRequiredError);
    await expect(waitForApproval({ check: async () => { throw new Error("db down"); }, ...c })).rejects.toThrow("db down");
  });
});

/**
 * The gated action runs inside withApproval; model that with an in-memory approvals table to prove
 * wrong-checksum approvals never click and a correct one clicks exactly once.
 */
describe("approval-gated click", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("clicks exactly once, only after a correct approval", async () => {
    const db = t.db;
    const ref = { action: "submit_report" as const, subjectId: "11111111-1111-1111-1111-111111111111", payload: "checksum-A" };
    const click = vi.fn(async () => "REPL-CA-0001-ABC123");
    const c = clock();
    let polls = 0;
    const gate = waitForApproval({
      check: async () => {
        if (++polls === 2) await approve(db, { ...ref, payload: "WRONG-CHECKSUM", approvedBy: "tester" });
        if (polls === 4) await approve(db, { ...ref, approvedBy: "tester" });
        return assertApproved(db, ref);
      },
      intervalMs: 2000,
      timeoutMs: 60_000,
      ...c,
    });
    await gate;
    expect(polls).toBe(4);
    expect(click).not.toHaveBeenCalled();
    await withApproval(db, ref, async () => click());
    await expect(withApproval(db, ref, async () => click())).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
