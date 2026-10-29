import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionValue, SESSION_COOKIE } from "@/app/login/gate";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());
const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), ...(init.cookie ? { cookie: init.cookie } : {}) } });

describe("proxy (H1 fail closed, M1 CSRF)", () => {
  it("production without APP_PASSCODE: pages get a 503 'Set APP_PASSCODE' page, APIs get 503 JSON", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "");
    const page = proxy(req("/approvals"));
    expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(await page.text()).toContain("Set APP_PASSCODE to use this deployment");
    const api = proxy(req("/api/outreach/x/approve", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(api.status).toBe(503);
    expect((await api.json()).error).toMatch(/APP_PASSCODE/);
  });
  it("production without APP_PASSCODE still serves the token/signature-authenticated surfaces", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "");
    for (const p of ["/replica/ca-holder", "/owner/abc", "/login"]) expect(proxy(req(p)).status).toBe(200);
    expect(proxy(req("/api/webhooks/lob", { method: "POST", body: "x", headers: { "content-type": "text/plain" } })).status).toBe(200);
    expect(proxy(req("/api/inngest", { method: "POST", body: "x", headers: { "content-type": "text/plain" } })).status).toBe(200);
  });
  it("development without a passcode stays open (demo)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_PASSCODE", "");
    expect(proxy(req("/approvals")).status).toBe(200);
  });
  it("with a session: text/plain and cross-origin POSTs to /api are refused, same-origin JSON passes", () => {
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const cookie = `${SESSION_COOKIE}=${createSessionValue("pw-for-test")}`;
    const post = (headers: Record<string, string>) => proxy(req("/api/clock", { method: "POST", body: '{"action":"reset"}', cookie, headers }));
    expect(post({ "content-type": "text/plain", origin: "http://localhost:3000" }).status).toBe(415);
    expect(post({ "content-type": "application/json", origin: "https://evil.example" }).status).toBe(403);
    expect(post({ "content-type": "application/json", origin: "http://localhost:3000" }).status).toBe(200);
  });
  it("unauthenticated pages redirect to /login and APIs 401 when a passcode is set", () => {
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    expect(proxy(req("/approvals")).status).toBe(307);
    expect(proxy(req("/api/clock")).status).toBe(401);
  });
});
