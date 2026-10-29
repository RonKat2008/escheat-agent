import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());
const post = (body: unknown = { action: "advance", days: 3650 }) =>
  POST(new Request("http://localhost/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/clock hardening (M5, M6)", () => {
  it("is refused in production without DEMO_MODE=1 (after the session check)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    vi.stubEnv("DEMO_MODE", "");
    // without a session: 401 (route-level auth even if the proxy were bypassed)
    expect((await post()).status).toBe(401);
  });
  it("authenticated but production without DEMO_MODE: 403", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const { createSessionValue, SESSION_COOKIE } = await import("@/app/login/gate");
    const res = await POST(
      new Request("http://localhost/api/clock", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${createSessionValue("pw-for-test")}` },
        body: JSON.stringify({ action: "advance", days: 3650 }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/DEMO_MODE=1/);
  });
  it("production with no passcode fails closed with 503", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "");
    expect((await post()).status).toBe(503);
  });
});
