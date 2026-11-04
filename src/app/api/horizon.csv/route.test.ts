import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/horizon.csv", () => {
  it("returns 401 without a session (route-level auth even if the proxy were bypassed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const res = await GET(new Request("http://localhost/api/horizon.csv"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with a forged session cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const { SESSION_COOKIE } = await import("@/app/login/gate");
    const res = await GET(new Request("http://localhost/api/horizon.csv", { headers: { cookie: `${SESSION_COOKIE}=forged` } }));
    expect(res.status).toBe(401);
  });
});
