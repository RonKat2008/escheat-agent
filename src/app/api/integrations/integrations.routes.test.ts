import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as qboConnect } from "./qbo/connect/route";
import { GET as qboCallback } from "./qbo/callback/route";
import { POST as qboPull } from "./qbo/pull/route";
import { POST as plaidLink } from "./plaid/link-token/route";
import { POST as plaidExchange } from "./plaid/exchange/route";
import { POST as plaidSync } from "./plaid/sync/route";
import { issueState, STATE_COOKIE } from "@/lib/integrations/oauth-state";

const KEYS = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI", "PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV", "QBO_TOKEN_SECRET", "OWNER_LINK_SECRET"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const post = () => new Request("http://localhost/api/x", { method: "POST", body: "{}" });

describe("not configured", () => {
  it("QBO endpoints return 501 with the sandbox message", async () => {
    for (const res of [
      await qboConnect(new Request("http://localhost/api/integrations/qbo/connect")),
      await qboCallback(new Request("http://localhost/api/integrations/qbo/callback?code=x&state=y")),
      await qboPull(post()),
    ]) {
      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({ error: "QuickBooks sandbox not configured" });
    }
  });

  it("Plaid endpoints return 501", async () => {
    for (const handler of [plaidLink, plaidExchange, plaidSync]) {
      const res = await handler(post());
      expect(res.status).toBe(501);
      expect((await res.json()).error).toMatch(/not configured/);
    }
  });

  it("QBO connect without a token secret is also 501 (never stores plaintext)", async () => {
    Object.assign(process.env, { QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", QBO_REDIRECT_URI: "http://localhost/cb" });
    const res = await qboConnect(new Request("http://localhost/api/integrations/qbo/connect"));
    expect(res.status).toBe(501);
  });
});

describe("QBO callback CSRF", () => {
  beforeEach(() => {
    Object.assign(process.env, { QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", QBO_REDIRECT_URI: "http://localhost/cb", QBO_TOKEN_SECRET: "s3cret" });
  });

  it("rejects a mismatched state", async () => {
    const issued = issueState("s3cret", "11111111-1111-4111-8111-111111111111");
    const res = await qboCallback(
      new Request("http://localhost/api/integrations/qbo/callback?code=c&realmId=1&state=attacker", {
        headers: { cookie: `${STATE_COOKIE}=${issued.cookie}` },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid OAuth state/);
  });

  it("rejects a callback with no state cookie", async () => {
    const res = await qboCallback(new Request("http://localhost/api/integrations/qbo/callback?code=c&realmId=1&state=x"));
    expect(res.status).toBe(400);
  });
});
