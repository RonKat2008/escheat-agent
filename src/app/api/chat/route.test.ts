import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ id: "s1" }),
  authErrorResponse: () => new Response(null, { status: 401 }),
}));
vi.mock("@/lib/chat/agent", () => ({ chatAvailability: () => "ready", runChatTurn: vi.fn() }));
vi.mock("@/lib/chat/rate-limit", () => ({ consumeChatTurn: () => ({ ok: true }) }));
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => ({}) }));
vi.mock("@/lib/pipeline/company", () => ({ resolveCompanyId: async () => null }));

import { POST } from "./route";

const CAP = 256 * 1024;
const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/chat", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));

describe("POST /api/chat body cap (L5)", () => {
  it("413s on an oversized content-length header without reading the body", async () => {
    const req = new Request("http://x/api/chat", { method: "POST", body: "{}", headers: { "content-length": String(CAP + 1) } });
    const text = vi.spyOn(req, "text");
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(text).not.toHaveBeenCalled();
  });

  it("413s when the body is over the cap in BYTES even though it is under the cap in characters", async () => {
    const body = "é".repeat(CAP / 2 + 1); // 131073 chars, 262146 bytes
    expect(body.length).toBeLessThan(CAP);
    expect((await post(body)).status).toBe(413);
  });

  it("413s an oversized body that lies about (or omits) content-length", async () => {
    expect((await post("a".repeat(CAP + 1), { "content-length": "10" })).status).toBe(413);
  });

  it("lets a normal body through to validation (400 for bad JSON, not 413)", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("ignores a malformed content-length header and falls back to the byte check", async () => {
    expect((await post("not json", { "content-length": "abc" })).status).toBe(400);
  });
});
