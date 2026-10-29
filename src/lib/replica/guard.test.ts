import { describe, expect, it, vi } from "vitest";
import {
  assertReplicaUrl,
  fencePlaywrightContext,
  isAllowedReplicaRequest,
  NonReplicaUrlError,
  type RoutableContext,
} from "./guard";

const BASE = "http://localhost:3000";
const PROD = "https://escheat.example.app";

describe("assertReplicaUrl", () => {
  it.each([
    "http://localhost:3000/replica/ca/login",
    "http://localhost:3000/replica/",
    "http://localhost:3000/replica/tx/search?name=x#frag",
    "http://127.0.0.1:3000/replica/de/",
    "http://localhost:3000/replica/a/../b",
  ])("allows %s", (u) => {
    expect(assertReplicaUrl(u, BASE)).toBeInstanceOf(URL);
  });

  it.each([
    "http://localhost:3000/replicaX",
    "http://localhost:3000/replica",
    "http://localhost:3000/replicas/ca",
    "http://localhost:3000/replica/../dashboard",
    "http://localhost:3000/replica/%2e%2e/dashboard",
    "http://localhost:3000/replica/%2E%2E/dashboard",
    "http://localhost:3000/replica/..%2fdashboard",
    "http://localhost:3000/replica/%2e%2e%2fdashboard",
    "http://localhost:3000/replica%2f..%2fdashboard",
    "http://localhost:3000/replica/..\\dashboard",
    "http://localhost:3000//replica/ca",
    "http://localhost@evil.com/replica/ca",
    "http://localhost:3000@evil.com/replica/ca",
    "http://user:pw@localhost:3000/replica/ca",
    "http://localhost:3001/replica/ca",
    "http://localhost/replica/ca",
    "https://localhost:3000/replica/ca",
    "http://evil.com/replica/ca",
    "http://localhost.evil.com:3000/replica/ca",
    "https://www.sos.ca.gov/",
    "https://unclaimed.com/replica/ca",
    "ftp://localhost:3000/replica/ca",
    "file:///replica/ca",
    "data:text/html,<h1>x</h1>",
    "javascript:alert(1)",
    "blob:http://localhost:3000/abc",
    "ws://localhost:3000/replica/x",
    "//evil.com/replica/ca",
    "/replica/ca",
    "",
    "not a url",
    "http://localhost:3000/dashboard",
    "http://localhost:3000/api/replica/x",
    "http://localhost:3000/replica/%00",
  ])("rejects %j", (u) => {
    expect(() => assertReplicaUrl(u, BASE)).toThrow(NonReplicaUrlError);
  });

  it("works against a production base URL and rejects the dev hosts", () => {
    expect(assertReplicaUrl(`${PROD}/replica/ca/x`, PROD)).toBeInstanceOf(URL);
    expect(() => assertReplicaUrl("http://localhost:3000/replica/ca", PROD)).toThrow(NonReplicaUrlError);
    expect(() => assertReplicaUrl(`http://escheat.example.app/replica/ca`, PROD)).toThrow(NonReplicaUrlError);
    expect(() => assertReplicaUrl(`${PROD}.evil.com/replica/ca`, PROD)).toThrow(NonReplicaUrlError);
  });

  it("rejects everything when APP_BASE_URL is invalid", () => {
    expect(() => assertReplicaUrl("http://localhost:3000/replica/x", "nope")).toThrow(NonReplicaUrlError);
    expect(() => assertReplicaUrl("http://localhost:3000/replica/x", "javascript:1")).toThrow(NonReplicaUrlError);
  });
});

describe("isAllowedReplicaRequest (network fence)", () => {
  it.each([
    `${BASE}/replica/ca/login`,
    `${BASE}/_next/static/chunks/app.js`,
    `${BASE}/_next/static/media/inter.woff2`,
    `${BASE}/_next/image?url=%2Flogo.png&w=64&q=75`,
    `${BASE}/favicon.ico`,
    `${BASE}/fonts/inter.woff2`,
    `${BASE}/assets/x.woff2`,
  ])("allows %s", (u) => expect(isAllowedReplicaRequest(u, BASE)).toBe(true));

  it.each([
    `${BASE}/dashboard`,
    `${BASE}/api/approvals`,
    `${BASE}/api/mcp`,
    `${BASE}/_next/data/x.json`,
    `${BASE}/_next/static/../../api/x`,
    `${BASE}/_next/static/%2e%2e/api`,
    `${BASE}/replicaX`,
    `https://api.anthropic.com/v1/messages`,
    `https://fonts.googleapis.com/css2?family=Inter`,
    `https://evil.com/_next/static/a.js`,
    `http://localhost:4000/replica/ca`,
    `data:image/png;base64,AAAA`,
    `wss://evil.com/socket`,
    `http://localhost@evil.com/replica/x`,
  ])("blocks %s", (u) => expect(isAllowedReplicaRequest(u, BASE)).toBe(false));
});

describe("fencePlaywrightContext", () => {
  function mockContext() {
    let handler: Parameters<RoutableContext["route"]>[1] | undefined;
    let pattern: unknown;
    const ctx: RoutableContext = {
      route: async (p, h) => {
        pattern = p;
        handler = h;
      },
    };
    const fire = async (url: string) => {
      const route = {
        request: () => ({ url: () => url }),
        continue: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
      };
      await handler!(route);
      return route;
    };
    return { ctx, fire, pattern: () => pattern };
  }

  it("continues allowed requests and aborts + logs blocked ones", async () => {
    const m = mockContext();
    const log = vi.fn();
    const fence = await fencePlaywrightContext(m.ctx, BASE, log);
    expect(m.pattern()).toBe("**/*");

    const ok = await m.fire(`${BASE}/replica/ca/login`);
    expect(ok.continue).toHaveBeenCalledOnce();
    expect(ok.abort).not.toHaveBeenCalled();

    const bad = await m.fire("https://www.sos.ca.gov/unclaimed");
    expect(bad.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(bad.continue).not.toHaveBeenCalled();

    expect(fence.blocked).toEqual(["https://www.sos.ca.gov/unclaimed"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("https://www.sos.ca.gov/unclaimed"));
  });
});
