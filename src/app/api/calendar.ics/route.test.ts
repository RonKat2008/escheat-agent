import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());
const get = (query = "", headers: Record<string, string> = {}) => GET(new Request(`http://localhost/api/calendar.ics${query}`, { headers }));

describe("GET /api/calendar.ics auth gate", () => {
  it("refuses without a passcode session (route-level, even if the proxy were bypassed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    expect((await get()).status).toBe(401);
  });

  it("fails closed with 503 in production when no passcode is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "");
    expect((await get()).status).toBe(503);
  });

  it("rejects a malformed state or horizon with 400 for an authenticated session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const { createSessionValue, SESSION_COOKIE } = await import("@/app/login/gate");
    const cookie = `${SESSION_COOKIE}=${createSessionValue("pw-for-test")}`;
    expect((await get("?state=CAL", { cookie })).status).toBe(400);
    expect((await get("?horizon=7", { cookie })).status).toBe(400);
    expect((await get("?horizon=abc", { cookie })).status).toBe(400);
  });
});
