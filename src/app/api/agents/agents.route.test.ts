import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionValue, SESSION_COOKIE } from "@/app/login/gate";
import { POST as filePost } from "./file/route";
import { POST as recoverPost } from "./recover/route";
import { POST as claimPost } from "./claim/[recoveryId]/route";

afterEach(() => vi.unstubAllEnvs());

const req = (cookie?: string) =>
  new Request("http://localhost/api/agents/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: "{}",
  });
const claimCtx = { params: Promise.resolve({ recoveryId: crypto.randomUUID() }) };

describe("agent routes in production (M5, M6)", () => {
  it("require a session even if the proxy were bypassed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    vi.stubEnv("AGENTS_ENABLED", "1");
    expect((await filePost(req())).status).toBe(401);
    expect((await recoverPost(req())).status).toBe(401);
    expect((await claimPost(req(), claimCtx)).status).toBe(401);
  });
  it("are disabled for an authenticated user unless AGENTS_ENABLED=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    vi.stubEnv("AGENTS_ENABLED", "");
    const cookie = `${SESSION_COOKIE}=${createSessionValue("pw-for-test")}`;
    for (const res of [await filePost(req(cookie)), await recoverPost(req(cookie)), await claimPost(req(cookie), claimCtx)]) {
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/AGENTS_ENABLED=1/);
    }
  });
  it("fail closed with 503 when the production passcode is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "");
    vi.stubEnv("AGENTS_ENABLED", "1");
    expect((await filePost(req())).status).toBe(503);
  });
});
