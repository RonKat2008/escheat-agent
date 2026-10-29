import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach } from "@/db/schema";
import { hmacSha256Hex } from "@/lib/crypto";
import { composeLetter } from "@/lib/letters/compose";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { seedItem, testEnv } from "@/lib/outreach/testing";

let t: TestDb;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));

import { POST as lobPost } from "./lob/route";
import { POST as agentmailPost } from "./agentmail/route";

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
  await t.db.update(outreach).set({ status: "sent", providerId: "ltr_route" }).where(eq(outreach.id, id));
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

const LOB = "lob_secret";
const lobReq = (raw: string, headers: Record<string, string>) => new Request("http://x/api/webhooks/lob", { method: "POST", body: raw, headers });
const lobBody = JSON.stringify({ id: "evt_r1", event_type: { id: "letter.rendered_pdf" }, body: { id: "ltr_route" } });
const nowSec = () => String(Math.floor(Date.now() / 1000));

describe("POST /api/webhooks/lob", () => {
  it("501 when the secret is not configured", async () => {
    vi.stubEnv("LOB_WEBHOOK_SECRET", "");
    const res = await lobPost(lobReq(lobBody, {}));
    expect(res.status).toBe(501);
  });

  it("valid signature appends the event", async () => {
    vi.stubEnv("LOB_WEBHOOK_SECRET", LOB);
    const ts = nowSec();
    const res = await lobPost(lobReq(lobBody, { "lob-signature": hmacSha256Hex(LOB, `${ts}.${lobBody}`), "lob-signature-timestamp": ts }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: true });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(JSON.stringify(row?.tracking)).toContain("letter.rendered_pdf");
  });

  it("invalid signature, tampered body and stale timestamp => 401 and nothing stored", async () => {
    vi.stubEnv("LOB_WEBHOOK_SECRET", LOB);
    const ts = nowSec();
    const good = hmacSha256Hex(LOB, `${ts}.${lobBody}`);
    expect((await lobPost(lobReq(lobBody, { "lob-signature": "f".repeat(64), "lob-signature-timestamp": ts }))).status).toBe(401);
    expect((await lobPost(lobReq(lobBody.replace("evt_r1", "evt_x"), { "lob-signature": good, "lob-signature-timestamp": ts }))).status).toBe(401);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect((await lobPost(lobReq(lobBody, { "lob-signature": hmacSha256Hex(LOB, `${old}.${lobBody}`), "lob-signature-timestamp": old }))).status).toBe(401);
    expect((await lobPost(lobReq(lobBody, {}))).status).toBe(401);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(JSON.stringify(row?.tracking)).not.toContain("evt_x");
  });
});

describe("POST /api/webhooks/agentmail", () => {
  const SECRET = `whsec_${Buffer.from("agentmail-test-secret-0123456789").toString("base64")}`;
  const raw = JSON.stringify({ type: "event", event_type: "message.delivered", event_id: "ev_route", delivery: { message_id: "msg_route", timestamp: "2026-11-01T00:00:00Z" } });
  const signed = (msgId: string, when: Date, body = raw, secret = SECRET) => ({
    "svix-id": msgId,
    "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(msgId, when, body),
  });
  const req = (body: string, headers: Record<string, string>) => new Request("http://x/api/webhooks/agentmail", { method: "POST", body, headers });

  it("501 when not configured", async () => {
    vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET", "");
    expect((await agentmailPost(req(raw, signed("m0", new Date())))).status).toBe(501);
  });

  it("valid svix signature updates tracking (delivered)", async () => {
    vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET", SECRET);
    await t.db.update(outreach).set({ providerId: "msg_route", channel: "email", status: "sent" }).where(eq(outreach.id, id));
    const res = await agentmailPost(req(raw, signed("msg_ok", new Date())));
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.status).toBe("delivered");
  });

  it("bad signature, wrong secret, missing headers, stale timestamp => 401", async () => {
    vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET", SECRET);
    const ok = signed("msg_bad", new Date());
    expect((await agentmailPost(req(raw, { ...ok, "svix-signature": "v1,AAAA" }))).status).toBe(401);
    expect((await agentmailPost(req(raw + " ", ok))).status).toBe(401);
    const other = `whsec_${Buffer.from("another-secret-0123456789abc").toString("base64")}`;
    expect((await agentmailPost(req(raw, signed("msg_o", new Date(), raw, other)))).status).toBe(401);
    expect((await agentmailPost(req(raw, {}))).status).toBe(401);
    expect((await agentmailPost(req(raw, signed("msg_old", new Date(Date.now() - 10 * 60 * 1000))))).status).toBe(401);
  });
});
