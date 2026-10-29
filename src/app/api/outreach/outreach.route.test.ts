import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach } from "@/db/schema";
import { seedItem, TEST_SECRET } from "@/lib/outreach/testing";
import { loadOutreach, outreachContentSha256 } from "@/lib/outreach/util";

let t: TestDb;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));
// Never reach the model: the LLM layer reports "not configured", so the template fallback is used.
vi.mock("@/lib/agents/letter-writer", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/letter-writer")>()),
  draftLetterVariables: async () => {
    const { AnthropicNotConfigured } = await import("@/lib/llm/errors");
    throw new AnthropicNotConfigured();
  },
}));

import { POST as draftPost } from "./draft/route";
import { POST as approvePost } from "./[id]/approve/route";
import { POST as sendPost } from "./[id]/send/route";
import { GET as previewGet } from "./[id]/preview/route";

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const reviewed = async (id: string) => outreachContentSha256(await loadOutreach(t.db, id));
const approveReq = async (id: string, extra: Record<string, unknown> = {}) =>
  new Request("http://x", json({ approvedBy: "ronit", expectedContentSha256: await reviewed(id), ...extra }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const draft = async (staleItemId: string, channel = "letter") => draftPost(new Request("http://x/d", json({ staleItemId, channel })));

function env(extra: Record<string, string> = {}) {
  vi.stubEnv("OWNER_LINK_SECRET", TEST_SECRET);
  vi.stubEnv("APP_BASE_URL", "https://escheat.test");
  vi.stubEnv("ALLOWED_TEST_RECIPIENTS", "owner@example.com");
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("LOB_TEST_API_KEY", "");
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

describe("outreach API", () => {
  it("draft validates input (400) and 404s for unknown items", async () => {
    env();
    expect((await draftPost(new Request("http://x/d", { method: "POST", body: "nope" }))).status).toBe(400);
    expect((await draft("not-a-uuid")).status).toBe(400);
    expect((await draftPost(new Request("http://x/d", json({ staleItemId: crypto.randomUUID(), channel: "fax" })))).status).toBe(400);
    expect((await draft(crypto.randomUUID())).status).toBe(404);
  });

  it("M2: approve requires the hash the reviewer saw; content changed since => 409 and nothing is approved", async () => {
    env();
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await (await draft(stale.id)).json();
    // missing hash
    expect((await approvePost(new Request("http://x", json({ approvedBy: "ronit" })), ctx(outreachId))).status).toBe(400);
    // preview exposes the hash
    const pv = await previewGet(new Request("http://x"), ctx(outreachId));
    const seen = pv.headers.get("x-content-sha256")!;
    expect(seen).toBe(await reviewed(outreachId));
    // content changes after the reviewer opened the preview
    await t.db.update(outreach).set({ body: "<html><body>changed after review</body></html>" }).where(eq(outreach.id, outreachId));
    const stale409 = await approvePost(new Request("http://x", json({ approvedBy: "ronit", expectedContentSha256: seen })), ctx(outreachId));
    expect(stale409.status).toBe(409);
    expect((await stale409.json()).code).toBe("reviewed_content_changed");
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row?.status).not.toBe("approved");
    expect(row?.approvalId).toBeNull();
  });

  it("letter: draft -> preview -> send before approve (403) -> approve -> send (501 not configured)", async () => {
    env();
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const d = await draft(stale.id);
    expect(d.status).toBe(201);
    const { outreachId, readiness } = await d.json();
    expect(readiness.ready).toBe(true);

    const pv = await previewGet(new Request("http://x"), ctx(outreachId));
    expect(pv.status).toBe(200);
    expect(pv.headers.get("content-type")).toMatch(/text\/html/);
    expect(pv.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await pv.text();
    expect(html).toContain("THE STATE OF CALIFORNIA REQUIRES US TO NOTIFY YOU");
    expect(html).toContain("UNVERIFIED");

    const noApproval = await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId));
    expect(noApproval.status).toBe(403);
    expect((await noApproval.json()).error).toMatch(/approval required/i);

    expect((await approvePost(new Request("http://x", json({})), ctx(outreachId))).status).toBe(400);
    const ap = await approvePost(await approveReq(outreachId), ctx(outreachId));
    expect(ap.status).toBe(201);
    const [afterApprove] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(afterApprove?.status).toBe("approved");
    expect(afterApprove?.sentAt).toBeNull();

    const send = await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId));
    expect(send.status).toBe(501);
    expect((await send.json()).error).toBe("lob not configured");
  });

  it("letter send with a live key => 403; offline send => 200 with sent:false", async () => {
    env({ LOB_TEST_API_KEY: "live_nope" });
    const { stale } = await seedItem(t.db, { ownerState: "DE" });
    const { outreachId } = await (await draft(stale.id)).json();
    await approvePost(await approveReq(outreachId), ctx(outreachId));
    expect((await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId))).status).toBe(403);

    env({ ESCHEAT_OFFLINE: "1" });
    const res = await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: false, offline: true });
  });

  it("not-ready (TX) letter: 422 on approve; preview shows the UNKNOWN placeholder", async () => {
    env();
    const { stale } = await seedItem(t.db, { ownerState: "TX" });
    const { outreachId } = await (await draft(stale.id)).json();
    const ap = await approvePost(await approveReq(outreachId), ctx(outreachId));
    expect(ap.status).toBe(422);
    const html = await (await previewGet(new Request("http://x"), ctx(outreachId))).text();
    expect(html).toContain("Required state language UNKNOWN");
    expect(html).toContain("NOT READY");
  });

  it("email: non-allowlisted recipient => 403 on approve and send", async () => {
    env({ AGENTMAIL_INBOX_ID: "escheat@agentmail.test", AGENTMAIL_API_KEY: "k" });
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await (await draft(stale.id, "email")).json();
    expect((await approvePost(await approveReq(outreachId, { approvedBy: "r", to: "evil@x.com" }), ctx(outreachId))).status).toBe(403);
    expect((await sendPost(new Request("http://x", json({ to: "evil@x.com" })), ctx(outreachId))).status).toBe(403);
  });

  it("409 when the outreach was already sent; 404 for unknown id; 400 for bad id", async () => {
    env();
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await (await draft(stale.id)).json();
    await t.db.update(outreach).set({ status: "sent" }).where(eq(outreach.id, outreachId));
    expect((await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId))).status).toBe(409);
    expect((await sendPost(new Request("http://x", { method: "POST" }), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await sendPost(new Request("http://x", { method: "POST" }), ctx("zzz"))).status).toBe(400);
    expect((await previewGet(new Request("http://x"), ctx(crypto.randomUUID()))).status).toBe(404);
  });

  it("409 when the approval was already consumed", async () => {
    env({ ESCHEAT_OFFLINE: "1" });
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await (await draft(stale.id)).json();
    await approvePost(await approveReq(outreachId), ctx(outreachId));
    expect((await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId))).status).toBe(200);
    // offline left status "approved"; the one-time approval is spent, so a re-send is refused as consumed
    const again = await sendPost(new Request("http://x", { method: "POST" }), ctx(outreachId));
    expect(again.status).toBe(409);
  });
});
