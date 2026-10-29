import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { createTestDb, type TestDb } from "@/db/client";
import { ledgerItems, outreach, payees, staleItems } from "@/db/schema";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { composeLetter } from "@/lib/letters/compose";
import { recordOwnerResponse } from "./owner-response";
import { seedItem, TEST_SECRET, testEnv } from "./testing";
import { OwnerTokenError } from "./tokens";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const failing = async () => {
  throw new AnthropicNotConfigured();
};

async function setup(opts: Parameters<typeof seedItem>[1] = {}) {
  const seeded = await seedItem(t.db, opts);
  const r = await composeLetter(t.db, seeded.stale.id, { env: testEnv(), draftVariables: failing });
  const token = r.ownerUrl!.split("/owner/")[1]!;
  return { ...seeded, outreachId: r.outreachId, token };
}
const deps = (extra = {}) => ({ secret: TEST_SECRET, sendEvent: vi.fn(async () => {}), ...extra });
const getStale = async (id: string) => (await t.db.select().from(staleItems).where(eq(staleItems.id, id)))[0]!;

describe("recordOwnerResponse", () => {
  it("send_money => owner_responded (never resolved_paid) with verify note, outreach responded, event sent", async () => {
    const s = await setup();
    const d = deps();
    const res = await recordOwnerResponse(t.db, s.token, { intent: "send_money", note: "please mail a new check" }, d);
    expect(res.staleStatus).toBe("owner_responded");
    const stale = await getStale(s.stale.id);
    expect(stale.status).toBe("owner_responded");
    expect(stale.resolvedAt).toBeNull();
    expect((stale.classification as { ownerResponse: { note: string; holderTask: string } }).ownerResponse).toMatchObject({
      holderTask: "verify_and_reissue",
    });
    const [o] = await t.db.select().from(outreach).where(eq(outreach.id, s.outreachId));
    expect(o?.status).toBe("responded");
    expect(o?.respondedAt).toBeInstanceOf(Date);
    expect(o?.tracking?.response).toMatchObject({ channel: "web", intent: "send_money", note: "please mail a new check" });
    expect(d.sendEvent).toHaveBeenCalledWith(expect.objectContaining({ staleItemId: s.stale.id, outcome: "claims_property" }));
  });

  it("already_cashed => owner_responded with a verify-cleared holder task (never resolved_paid)", async () => {
    const s = await setup();
    const d = deps();
    await recordOwnerResponse(t.db, s.token, { intent: "already_cashed" }, d);
    const stale = await getStale(s.stale.id);
    expect(stale.status).toBe("owner_responded");
    expect(stale.resolvedAt).toBeNull();
    expect((stale.classification as { ownerResponse: { holderTask: string } }).ownerResponse.holderTask).toBe("verify_cleared");
    expect(d.sendEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "no_longer_owner" }));
  });

  it("confirm_address => owner_responded and address saved on payee + ledger item", async () => {
    const s = await setup();
    await recordOwnerResponse(
      t.db,
      s.token,
      { intent: "confirm_address", address: { line1: "9 New St", city: "Oakland", state: "ca", zip: "94607" } },
      deps(),
    );
    expect((await getStale(s.stale.id)).status).toBe("owner_responded");
    const [p] = await t.db.select().from(payees).where(eq(payees.id, s.stale.ownerPayeeId!));
    expect(p).toMatchObject({ addressLine: "9 New St", city: "Oakland", state: "CA", zip: "94607" });
    const [l] = await t.db.select().from(ledgerItems).where(eq(ledgerItems.id, s.ledger.id));
    expect(l?.addressLine).toBe("9 New St");
  });

  it("confirm_address without an address is rejected and the token stays usable", async () => {
    const s = await setup();
    await expect(recordOwnerResponse(t.db, s.token, { intent: "confirm_address" }, deps())).rejects.toBeInstanceOf(ZodError);
    await expect(recordOwnerResponse(t.db, s.token, { intent: "already_cashed" }, deps())).resolves.toBeTruthy();
  });

  it("token reuse is rejected and changes nothing", async () => {
    const s = await setup();
    await recordOwnerResponse(t.db, s.token, { intent: "already_cashed" }, deps());
    const d = deps();
    await expect(recordOwnerResponse(t.db, s.token, { intent: "send_money" }, d)).rejects.toMatchObject({ reason: "already_used" });
    expect(d.sendEvent).not.toHaveBeenCalled();
    expect((await getStale(s.stale.id)).status).toBe("owner_responded");
    const [o] = await t.db.select().from(outreach).where(eq(outreach.id, s.outreachId));
    expect((o?.tracking?.response as { intent: string }).intent).toBe("already_cashed");
  });

  it("concurrent double-submit: exactly one wins", async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      recordOwnerResponse(t.db, s.token, { intent: "already_cashed" }, deps()),
      recordOwnerResponse(t.db, s.token, { intent: "send_money" }, deps()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OwnerTokenError);
  });

  it("expired, tampered and malformed tokens are rejected", async () => {
    const s = await setup();
    await expect(recordOwnerResponse(t.db, s.token, { intent: "send_money" }, deps({ now: new Date(Date.now() + 200 * 24 * 3600 * 1000) }))).rejects.toMatchObject({ reason: "expired" });
    await expect(recordOwnerResponse(t.db, `${s.token}x`, { intent: "send_money" }, deps())).rejects.toBeInstanceOf(OwnerTokenError);
    await expect(recordOwnerResponse(t.db, "garbage", { intent: "send_money" }, deps())).rejects.toMatchObject({ reason: "malformed" });
    expect((await getStale(s.stale.id)).status).toBe("dd_pending");
  });

  it("does not regress items already reported", async () => {
    const s = await setup({ status: "reported" });
    const res = await recordOwnerResponse(t.db, s.token, { intent: "send_money" }, deps());
    expect(res.staleStatus).toBe("reported");
    expect((await getStale(s.stale.id)).status).toBe("reported");
  });

  it.each(["to_report", "reported", "remitted"] as const)(
    "public response never moves a %s item (response is recorded only)",
    async (status) => {
      for (const intent of ["send_money", "already_cashed"] as const) {
        const s = await setup({ status });
        const res = await recordOwnerResponse(t.db, s.token, { intent }, deps());
        expect(res.staleStatus).toBe(status);
        const stale = await getStale(s.stale.id);
        expect(stale.status).toBe(status);
        expect(stale.resolvedAt).toBeNull();
        expect((stale.classification as { ownerResponse: { intent: string } }).ownerResponse.intent).toBe(intent);
      }
    },
  );

  it("free text is parsed when configured; parser failure is recorded, not fatal; event failure is best effort", async () => {
    const a = await setup();
    const parseReply = vi.fn(async () => ({ intent: "send_money" as const, confidence: 0.9 }));
    await recordOwnerResponse(t.db, a.token, { intent: "already_cashed", note: "send it to me" }, deps({ parseReply }));
    const [oa] = await t.db.select().from(outreach).where(eq(outreach.id, a.outreachId));
    expect((oa?.tracking?.response as { parsedNote: { intent: string } }).parsedNote.intent).toBe("send_money");

    const b = await setup();
    const parseFail = vi.fn(async () => {
      throw new AnthropicNotConfigured();
    });
    const sendEvent = vi.fn(async () => {
      throw new Error("inngest down");
    });
    await expect(recordOwnerResponse(t.db, b.token, { intent: "already_cashed", note: "hi" }, deps({ parseReply: parseFail, sendEvent }))).resolves.toBeTruthy();
    const [ob] = await t.db.select().from(outreach).where(eq(outreach.id, b.outreachId));
    expect(ob?.tracking?.response).toMatchObject({ parsedNote: null, parseError: "AnthropicNotConfigured" });
  });

  it("rejects bad address shape", async () => {
    const s = await setup();
    await expect(
      recordOwnerResponse(t.db, s.token, { intent: "confirm_address", address: { line1: "1 A St", city: "X", state: "California", zip: "9" } }, deps()),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
