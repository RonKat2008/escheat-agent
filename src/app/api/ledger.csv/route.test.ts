import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());
const get = (query = "", headers: Record<string, string> = {}) => GET(new Request(`http://localhost/api/ledger.csv${query}`, { headers }));

describe("GET /api/ledger.csv auth gate", () => {
  it("refuses without a passcode session (route-level, even if the proxy were bypassed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    expect((await get()).status).toBe(401);
    expect((await get("?period=fy")).status).toBe(401);
  });

  it("rejects an unknown period with 400 for an authenticated session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const { createSessionValue, SESSION_COOKIE } = await import("@/app/login/gate");
    const cookie = `${SESSION_COOKIE}=${createSessionValue("pw-for-test")}`;
    expect((await get("?period=decade", { cookie })).status).toBe(400);
  });
});
