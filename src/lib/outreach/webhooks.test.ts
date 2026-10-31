import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach, webhookEvents } from "@/db/schema";
import { hmacSha256Hex } from "@/lib/crypto";
import { composeLetter } from "@/lib/letters/compose";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { seedItem, testEnv } from "./testing";
import { applyAgentMailEvent, applyLobEvent, verifyLobSignature } from "./webhooks";

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

  it("AgentMail delivered/bounced/rejected update tracking; unknown message id is ignored", async () => {
    await t.db.update(outreach).set({ status: "sent", providerId: "msg_am9", channel: "email" }).where(eq(outreach.id, id));
    const delivered = { event_type: "message.delivered", event_id: "ev_1", delivery: { message_id: "msg_am9", timestamp: "2026-11-01T00:00:00Z" } };
    await applyAgentMailEvent(t.db, delivered);
    expect((await t.db.select().from(outreach).where(eq(outreach.id, id)))[0]?.status).toBe("delivered");
    expect(await applyAgentMailEvent(t.db, delivered)).toMatchObject({ duplicate: true });
    await applyAgentMailEvent(t.db, { event_type: "message.bounced", event_id: "ev_2", bounce: { message_id: "msg_am9", type: "Permanent", sub_type: "General" } });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.status).toBe("failed");
    expect(JSON.stringify(row?.tracking)).toContain("Permanent/General");
    expect(await applyAgentMailEvent(t.db, { event_type: "message.delivered", event_id: "ev_3", delivery: { message_id: "nope" } })).toEqual({ matched: false });
    // inbound replies are out of scope: no message_id match, nothing recorded
    expect(await applyAgentMailEvent(t.db, { event_type: "message.received", event_id: "ev_4" })).toEqual({ matched: false });
  });

  describe("L6: atomic dedupe keyed on (source, event id)", () => {
    const eventsOf = async () => ((await t.db.select().from(outreach).where(eq(outreach.id, id)))[0]?.tracking?.events as { id: string }[] | undefined) ?? [];

    it("concurrent duplicate AgentMail deliveries record exactly once", async () => {
      await t.db.update(outreach).set({ status: "sent", providerId: "msg_conc", channel: "email", tracking: null }).where(eq(outreach.id, id));
      const ev = { event_type: "message.delivered", event_id: "ev_conc", delivery: { message_id: "msg_conc" } };
      const results = await Promise.all(Array.from({ length: 6 }, () => applyAgentMailEvent(t.db, ev)));
      expect(results.filter((r) => r.duplicate).length).toBe(5);
      expect((await eventsOf()).filter((e) => e.id === "ev_conc")).toHaveLength(1);
    });

    it("concurrent duplicate Lob deliveries record exactly once", async () => {
      await t.db.update(outreach).set({ status: "sent", providerId: "ltr_conc", channel: "letter", tracking: null }).where(eq(outreach.id, id));
      const ev = { id: "evt_conc", event_type: { id: "letter.created" }, body: { id: "ltr_conc" } };
      const results = await Promise.all(Array.from({ length: 6 }, () => applyLobEvent(t.db, ev)));
      expect(results.filter((r) => r.duplicate).length).toBe(5);
      expect((await eventsOf()).filter((e) => e.id === "evt_conc")).toHaveLength(1);
    });

    it("falls back to the svix-id header when event_id is missing", async () => {
      await t.db.update(outreach).set({ status: "sent", providerId: "msg_svix", channel: "email", tracking: null }).where(eq(outreach.id, id));
      const ev = { event_type: "message.delivered", delivery: { message_id: "msg_svix" } };
      expect(await applyAgentMailEvent(t.db, ev, new Date(), { svixId: "msg_abc" })).toMatchObject({ matched: true });
      expect(await applyAgentMailEvent(t.db, ev, new Date(), { svixId: "msg_abc" })).toMatchObject({ duplicate: true });
      expect(await applyAgentMailEvent(t.db, ev, new Date(), { svixId: "msg_def" })).not.toHaveProperty("duplicate");
      expect((await eventsOf()).map((e) => e.id)).toEqual(["msg_abc", "msg_def"]);
    });

    it("the same event id from different sources is not a duplicate", async () => {
      await t.db.update(outreach).set({ status: "sent", providerId: "same", channel: "email", tracking: null }).where(eq(outreach.id, id));
      await applyAgentMailEvent(t.db, { event_type: "message.delivered", event_id: "shared", delivery: { message_id: "same" } });
      expect(await applyLobEvent(t.db, { id: "shared", event_type: { id: "letter.created" }, body: { id: "same" } })).not.toHaveProperty("duplicate");
    });

    it("the database enforces uniqueness on (source, event_id)", async () => {
      await t.db.insert(webhookEvents).values({ source: "lob", eventId: "uniq" });
      await expect(t.db.insert(webhookEvents).values({ source: "lob", eventId: "uniq" })).rejects.toThrow();
    });
  });
});
