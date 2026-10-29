import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach } from "@/db/schema";
import { hmacSha256Hex } from "@/lib/crypto";
import { composeLetter } from "@/lib/letters/compose";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { seedItem, testEnv } from "./testing";
import { applyLobEvent, applyResendEvent, verifyLobSignature } from "./webhooks";

const SECRET = "lob_whsec_test";
const body = JSON.stringify({ id: "evt_1", event_type: { id: "letter.created" }, body: { id: "ltr_1" } });
const sign = (ts: string, raw = body, secret = SECRET) => hmacSha256Hex(secret, `${ts}.${raw}`);
const NOW = new Date("2026-11-01T12:00:00Z");
const tsSec = String(Math.floor(NOW.getTime() / 1000));

describe("verifyLobSignature", () => {
  const base = { rawBody: body, secret: SECRET, now: NOW };
  it("accepts a valid signature (seconds and milliseconds timestamps)", () => {
    expect(verifyLobSignature({ ...base, timestamp: tsSec, signature: sign(tsSec) })).toEqual({ ok: true });
    const ms = String(NOW.getTime());
    expect(verifyLobSignature({ ...base, timestamp: ms, signature: sign(ms) })).toEqual({ ok: true });
  });
  it("rejects a wrong signature, wrong secret, and tampered body", () => {
    expect(verifyLobSignature({ ...base, timestamp: tsSec, signature: "0".repeat(64) })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyLobSignature({ ...base, timestamp: tsSec, signature: sign(tsSec, body, "other") })).toMatchObject({ ok: false });
    expect(verifyLobSignature({ ...base, rawBody: body + " ", timestamp: tsSec, signature: sign(tsSec) })).toMatchObject({ ok: false, reason: "bad_signature" });
  });
  it("rejects stale (>5 min) and future timestamps even when correctly signed", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 301);
    expect(verifyLobSignature({ ...base, timestamp: old, signature: sign(old) })).toMatchObject({ ok: false, reason: "stale_timestamp" });
    const future = String(Math.floor(NOW.getTime() / 1000) + 301);
    expect(verifyLobSignature({ ...base, timestamp: future, signature: sign(future) })).toMatchObject({ ok: false, reason: "stale_timestamp" });
    const edge = String(Math.floor(NOW.getTime() / 1000) - 299);
    expect(verifyLobSignature({ ...base, timestamp: edge, signature: sign(edge) })).toEqual({ ok: true });
  });
  it("rejects missing headers and non-numeric timestamps", () => {
    expect(verifyLobSignature({ ...base, timestamp: null, signature: "x" })).toMatchObject({ reason: "missing_headers" });
    expect(verifyLobSignature({ ...base, timestamp: tsSec, signature: null })).toMatchObject({ reason: "missing_headers" });
    expect(verifyLobSignature({ ...base, timestamp: "abc", signature: "x" })).toMatchObject({ reason: "bad_timestamp" });
  });
});

describe("applying webhook events", () => {
  let t: TestDb;
  let id: string;
  beforeAll(async () => {
    t = await createTestDb();
    const { stale } = await seedItem(t.db);
    const r = await composeLetter(t.db, stale.id, {
      env: testEnv(),
      draftVariables: async () => {
        throw new AnthropicNotConfigured();
      },
    });
    id = r.outreachId;
    await t.db.update(outreach).set({ status: "sent", providerId: "ltr_1" }).where(eq(outreach.id, id));
  });
  afterAll(async () => {
    await t.close();
  });

  it("appends Lob events idempotently and marks delivered", async () => {
    expect(await applyLobEvent(t.db, { id: "evt_1", event_type: { id: "letter.created" }, body: { id: "ltr_1" } })).toMatchObject({ matched: true });
    expect(await applyLobEvent(t.db, { id: "evt_1", event_type: { id: "letter.created" }, body: { id: "ltr_1" } })).toMatchObject({ duplicate: true });
    await applyLobEvent(t.db, { id: "evt_2", event_type: { id: "letter.delivered" }, body: { id: "ltr_1" } });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.status).toBe("delivered");
    expect((row?.tracking?.events as unknown[]).length).toBe(2);
    expect(await applyLobEvent(t.db, { id: "evt_3", body: { id: "ltr_unknown" } })).toEqual({ matched: false });
  });

  it("Resend delivered/bounced update tracking; unknown email id is ignored", async () => {
    await t.db.update(outreach).set({ status: "sent", providerId: "re_9", channel: "email" }).where(eq(outreach.id, id));
    await applyResendEvent(t.db, { type: "email.delivered", data: { email_id: "re_9" } }, "msg_1");
    expect((await t.db.select().from(outreach).where(eq(outreach.id, id)))[0]?.status).toBe("delivered");
    expect(await applyResendEvent(t.db, { type: "email.delivered", data: { email_id: "re_9" } }, "msg_1")).toMatchObject({ duplicate: true });
    await applyResendEvent(t.db, { type: "email.bounced", data: { email_id: "re_9", bounce: { message: "mailbox full" } } }, "msg_2");
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.status).toBe("failed");
    expect(JSON.stringify(row?.tracking)).toContain("mailbox full");
    expect(await applyResendEvent(t.db, { type: "email.delivered", data: { email_id: "nope" } }, "msg_3")).toEqual({ matched: false });
  });
});
