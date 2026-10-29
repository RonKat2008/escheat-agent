import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach } from "@/db/schema";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { allowedMcpHosts, checkMcpAuth, checkMcpOrigin } from "./auth";
import { handleMcpRequest } from "./http";
import { createEscheatMcpServer } from "./server";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
let t: TestDb;
let staleA: string;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  t = await createTestDb();
  const f = await insertFixture(t.db, STANDARD_ITEMS);
  staleA = f.ids.a!.staleId;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

async function connect() {
  const server = createEscheatMcpServer(t.db);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}
const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);
const json = (r: unknown) => JSON.parse(/```json\n([\s\S]*)\n```/.exec(text(r))![1]!);

describe("MCP server (in-memory transport)", () => {
  it("lists the read-only tools and the one draft tool with annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([
      "create_outreach_draft",
      "explain_item",
      "get_audit_interest_exposure",
      "get_exposure",
      "list_stale_items",
      "upcoming_deadlines",
    ]);
    for (const tool of tools) {
      if (tool.name === "create_outreach_draft") expect(tool.annotations?.readOnlyHint).toBe(false);
      else expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("get_exposure returns totals, disclaimer and the unverified note", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "get_exposure", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(DISCLAIMER);
    expect(text(r)).toContain("UNVERIFIED");
    const data = json(r);
    expect(data.totalCents).toBe(310050);
    expect(data.byState.find((s: { state: string }) => s.state === "CA").cents).toBe(234000);
    const tx = json(await client.callTool({ name: "get_exposure", arguments: { state: "TX" } }));
    expect(tx.totalCents).toBe(50000);
  });

  it("list_stale_items, upcoming_deadlines, explain_item and interest work end to end", async () => {
    const { client } = await connect();
    const list = json(await client.callTool({ name: "list_stale_items", arguments: { state: "CA" } }));
    expect(list.items).toHaveLength(1);
    const dl = json(await client.callTool({ name: "upcoming_deadlines", arguments: { days: 30 } }));
    expect(dl.events.length).toBeGreaterThan(0);
    const ex = await client.callTool({ name: "explain_item", arguments: { id_or_check_number: "10482" } });
    expect(json(ex).timeline[0].sources.length).toBeGreaterThan(0);
    expect(text(ex)).toContain(DISCLAIMER);
    const missing = await client.callTool({ name: "explain_item", arguments: { id_or_check_number: "999999" } });
    expect(missing.isError).toBe(true);
    const interest = await client.callTool({ name: "get_audit_interest_exposure", arguments: {} });
    expect(text(interest)).toContain("Estimate; rule unverified");
  });

  it("create_outreach_draft inserts a draft row, never sends, and is idempotent", async () => {
    const { client } = await connect();
    const first = await client.callTool({ name: "create_outreach_draft", arguments: { item_id: "10482" } });
    expect(first.isError).toBeFalsy();
    expect(text(first)).toContain("Draft only — a human must approve in the app at /approvals");
    expect(text(first)).toContain(DISCLAIMER);
    const d1 = json(first);
    expect(d1).toMatchObject({ created: true, status: "draft", channel: "letter", staleItemId: staleA });

    const rows = await t.db.select().from(outreach).where(eq(outreach.staleItemId, staleA));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "draft", sentAt: null, providerId: null, approvalId: null, previewUrl: null });
    expect(rows[0]!.toAddress).toContain("Testville");
    // L6: the stored body is escaped HTML (payee text comes from imported files), so no raw markup can reach Lob or the preview
    expect(rows[0]!.body).toMatch(/^<!doctype html>/);
    expect(rows[0]!.body!.replace(/<!doctype html>|<\/?(html|body|pre)\b[^>]*>/gi, "")).not.toContain("<");
    expect(await t.db.select().from(approvals)).toHaveLength(0);

    const second = json(await client.callTool({ name: "create_outreach_draft", arguments: { item_id: staleA } }));
    expect(second).toMatchObject({ created: false, outreachId: d1.outreachId });
    expect(await t.db.select().from(outreach)).toHaveLength(1);
  });

  it("create_outreach_draft refuses closed items and unknown ids", async () => {
    const { client } = await connect();
    expect((await client.callTool({ name: "create_outreach_draft", arguments: { item_id: "40001" } })).isError).toBe(true);
    expect((await client.callTool({ name: "create_outreach_draft", arguments: { item_id: "zzz" } })).isError).toBe(true);
    expect(await t.db.select().from(outreach)).toHaveLength(0);
  });
});

describe("HTTP auth + route handler", () => {
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(rpc),
    });

  it("checkMcpAuth: 503 when unset in EVERY environment (development included), 401 on mismatch", () => {
    expect(checkMcpAuth(null, {})).toMatchObject({ ok: false, status: 503, message: "MCP_TOKEN not configured" });
    expect(checkMcpAuth(null, { MCP_TOKEN: "" })).toMatchObject({ ok: false, status: 503 });
    expect(checkMcpAuth("Bearer wrong", { MCP_TOKEN: "s3cret" })).toMatchObject({ ok: false, status: 401 });
    expect(checkMcpAuth("s3cret", { MCP_TOKEN: "s3cret" })).toMatchObject({ ok: false, status: 401 });
    expect(checkMcpAuth("Bearer s3cret", { MCP_TOKEN: "s3cret" })).toEqual({ ok: true });
  });

  it("401 without token, 200 with token for tools/list", async () => {
    vi.stubEnv("MCP_TOKEN", "s3cret");
    const get = async () => t.db;
    expect((await handleMcpRequest(req(), get)).status).toBe(401);
    expect((await handleMcpRequest(req({ authorization: "Bearer nope" }), get)).status).toBe(401);
    const ok = await handleMcpRequest(req({ authorization: "Bearer s3cret" }), get);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.result.tools.map((x: { name: string }) => x.name)).toContain("get_exposure");
  });

  it("L1: DNS rebinding / cross-origin: foreign Host or Origin is 403 even with a valid token", async () => {
    vi.stubEnv("MCP_TOKEN", "s3cret");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const get = async () => t.db;
    const auth = { authorization: "Bearer s3cret" };
    expect((await handleMcpRequest(req({ ...auth, host: "localhost:3000" }), get)).status).toBe(200);
    expect((await handleMcpRequest(req({ ...auth, host: "evil.example.com" }), get)).status).toBe(403);
    expect((await handleMcpRequest(req({ ...auth, host: "localhost:3000", origin: "https://evil.example.com" }), get)).status).toBe(403);
    expect((await handleMcpRequest(req({ ...auth, host: "localhost:3000", origin: "http://localhost:3000" }), get)).status).toBe(200);
  });

  it("allowedMcpHosts/checkMcpOrigin: production allows only configured hosts (no loopback)", () => {
    const env = { NODE_ENV: "production", APP_BASE_URL: "https://escheat.example.com" };
    expect(checkMcpOrigin(new Headers({ host: "escheat.example.com" }), "https://escheat.example.com/api/mcp", env).ok).toBe(true);
    expect(checkMcpOrigin(new Headers({ host: "localhost:3000" }), "http://localhost:3000/api/mcp", env)).toMatchObject({ ok: false, status: 403 });
    expect(checkMcpOrigin(new Headers({ host: "escheat.example.com", origin: "https://other.example" }), "https://escheat.example.com/api/mcp", env).ok).toBe(false);
    expect(allowedMcpHosts({ NODE_ENV: "production", VERCEL_URL: "x-abc.vercel.app" })).toEqual(["x-abc.vercel.app"]);
  });

  it("503 when MCP_TOKEN is unset in production", async () => {
    vi.stubEnv("MCP_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await handleMcpRequest(req(), async () => t.db);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("MCP_TOKEN not configured");
  });

  it("the Next route module rejects unauthenticated calls before touching the database", async () => {
    vi.stubEnv("MCP_TOKEN", "s3cret");
    const { POST } = await import("@/app/api/mcp/route");
    expect((await POST(req())).status).toBe(401);
  });
});
