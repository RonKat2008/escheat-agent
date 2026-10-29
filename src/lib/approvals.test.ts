import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals } from "@/db/schema";
import {
  ApprovalAlreadyConsumedError,
  ApprovalRequiredError,
  approve,
  assertApproved,
  consumeApproval,
  requestApprovalPayloadHash,
  withApproval,
} from "./approvals";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

let n = 0;
const subj = () => `item-${++n}`;

describe("approvals", () => {
  it("hash is stable across key order", () => {
    expect(requestApprovalPayloadHash({ a: 1, b: 2 })).toBe(requestApprovalPayloadHash({ b: 2, a: 1 }));
  });

  it("approve stores the payload hash and approver", async () => {
    const s = subj();
    const row = await approve(t.db, { action: "mail_letter", subjectId: s, payload: { to: "x" }, approvedBy: "ronit" });
    expect(row.payloadSha256).toBe(requestApprovalPayloadHash({ to: "x" }));
    expect(row.approvedBy).toBe("ronit");
    expect(row.consumedAt).toBeNull();
  });

  it("throws when nothing is approved", async () => {
    await expect(assertApproved(t.db, { action: "send_email", subjectId: subj(), payload: {} })).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
  });

  it("throws after the payload is edited post-approval", async () => {
    const s = subj();
    await approve(t.db, { action: "send_email", subjectId: s, payload: { body: "hi", to: "a" }, approvedBy: "r" });
    await expect(
      assertApproved(t.db, { action: "send_email", subjectId: s, payload: { body: "hi!", to: "a" } }),
    ).rejects.toMatchObject({ reason: "payload_changed" });
    await expect(
      assertApproved(t.db, { action: "send_email", subjectId: s, payload: { to: "a", body: "hi" } }),
    ).resolves.toBeDefined();
  });

  it("wrong action or wrong subject throws", async () => {
    const s = subj();
    await approve(t.db, { action: "place_call", subjectId: s, payload: { p: 1 }, approvedBy: "r" });
    await expect(assertApproved(t.db, { action: "send_email", subjectId: s, payload: { p: 1 } })).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
    await expect(
      assertApproved(t.db, { action: "place_call", subjectId: subj(), payload: { p: 1 } }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("an unapproved (approvedAt null) row never satisfies the gate", async () => {
    const s = subj();
    await t.db.insert(approvals).values({
      action: "file_claim",
      subjectId: s,
      payloadSha256: requestApprovalPayloadHash({ a: 1 }),
    });
    await expect(assertApproved(t.db, { action: "file_claim", subjectId: s, payload: { a: 1 } })).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
  });

  it("consumed approval cannot be reused; second consume throws", async () => {
    const s = subj();
    const a = await approve(t.db, { action: "submit_report", subjectId: s, payload: { r: 1 }, approvedBy: "r" });
    await consumeApproval(t.db, a.id);
    await expect(consumeApproval(t.db, a.id)).rejects.toBeInstanceOf(ApprovalAlreadyConsumedError);
    await expect(
      assertApproved(t.db, { action: "submit_report", subjectId: s, payload: { r: 1 } }),
    ).rejects.toMatchObject({ reason: "consumed" });
  });

  it("consume of a nonexistent id throws", async () => {
    await expect(consumeApproval(t.db, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
      ApprovalAlreadyConsumedError,
    );
  });

  it("a fresh approval after consumption re-opens the gate once", async () => {
    const s = subj();
    const args = { action: "apply_rule_change" as const, subjectId: s, payload: { v: 2 } };
    const a1 = await approve(t.db, { ...args, approvedBy: "r" });
    await consumeApproval(t.db, a1.id);
    const a2 = await approve(t.db, { ...args, approvedBy: "r" });
    expect((await assertApproved(t.db, args)).id).toBe(a2.id);
  });

  it("concurrent consume: exactly one wins", async () => {
    const a = await approve(t.db, { action: "mail_letter", subjectId: subj(), payload: {}, approvedBy: "r" });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeApproval(t.db, a.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
  });

  it("withApproval consumes on success", async () => {
    const s = subj();
    const args = { action: "mail_letter" as const, subjectId: s, payload: { l: 1 } };
    await approve(t.db, { ...args, approvedBy: "r" });
    await expect(withApproval(t.db, args, async () => "sent")).resolves.toBe("sent");
    await expect(withApproval(t.db, args, async () => "again")).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("withApproval without approval never runs the executor", async () => {
    let ran = false;
    await expect(
      withApproval(t.db, { action: "mail_letter", subjectId: subj(), payload: {} }, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(ran).toBe(false);
  });

  it("withApproval leaves approval unconsumed when executor fails, and rethrows", async () => {
    const s = subj();
    const args = { action: "send_email" as const, subjectId: s, payload: { e: 1 } };
    const a = await approve(t.db, { ...args, approvedBy: "r" });
    await expect(
      withApproval(t.db, args, async () => {
        throw new Error("provider down");
      }),
    ).rejects.toThrow("provider down");
    const [row] = await t.db.select().from(approvals).where(eq(approvals.id, a.id));
    expect(row!.consumedAt).toBeNull();
    await expect(withApproval(t.db, args, async () => "ok")).resolves.toBe("ok");
  });

  it("concurrent withApproval runs the executor exactly once", async () => {
    const s = subj();
    const args = { action: "place_call" as const, subjectId: s, payload: { c: 1 } };
    await approve(t.db, { ...args, approvedBy: "r" });
    let runs = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        withApproval(t.db, args, async () => {
          runs += 1;
          await new Promise((r) => setTimeout(r, 20));
        }),
      ),
    );
    expect(runs).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("approve requires an approver", async () => {
    await expect(
      approve(t.db, { action: "mail_letter", subjectId: subj(), payload: {}, approvedBy: "  " }),
    ).rejects.toThrow();
  });
});
