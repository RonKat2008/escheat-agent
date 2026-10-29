import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionValue, SESSION_COOKIE } from "@/app/login/gate";
import { approverLabel, AuthError, requireSession, sessionGuard } from "./session";

afterEach(() => vi.unstubAllEnvs());
const req = (cookie?: string) => new Request("http://localhost/api/x", { method: "POST", headers: cookie ? { cookie } : {} });

describe("requireSession (M6 defense in depth)", () => {
  it("passes in dev when the gate is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_PASSCODE", "");
    const s = await requireSession(req());
    expect(s.gateDisabled).toBe(true);
    expect(approverLabel(s, "Dana")).toBe("Dana (local dev, gate disabled)");
  });
  it("FAILS CLOSED (503) in production without APP_PASSCODE", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "");
    await expect(requireSession(req())).rejects.toMatchObject({ status: 503 });
    const res = await sessionGuard(req());
    expect(res?.status).toBe(503);
  });
  it("FAILS CLOSED when VERCEL is set", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_PASSCODE", "");
    expect((await sessionGuard(req()))?.status).toBe(503);
  });
  it("requires a valid session cookie when a passcode is set", async () => {
    vi.stubEnv("APP_PASSCODE", "open-sesame");
    await expect(requireSession(req())).rejects.toBeInstanceOf(AuthError);
    expect((await sessionGuard(req(`${SESSION_COOKIE}=garbage`)))?.status).toBe(401);
    const cookie = createSessionValue("open-sesame");
    const s = await requireSession(req(`a=b; ${SESSION_COOKIE}=${cookie}`));
    expect(s.gateDisabled).toBe(false);
    expect(s.id).toMatch(/^[0-9a-f]{16}$/);
    expect(approverLabel(s, "Dana")).toBe(`Dana (passcode session ${s.id.slice(0, 8)})`);
    expect(await sessionGuard(req(`${SESSION_COOKIE}=${cookie}`))).toBeNull();
  });
  it("rejects a cookie signed for another passcode", async () => {
    vi.stubEnv("APP_PASSCODE", "open-sesame");
    expect((await sessionGuard(req(`${SESSION_COOKIE}=${createSessionValue("other")}`)))?.status).toBe(401);
  });
});
