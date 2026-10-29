import { describe, expect, it, vi } from "vitest";
import {
  assertReplicaUrl,
  fencePlaywrightContext,
  fenceChromiumArgs,
  hardenContext,
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
  ])("allows %s", (u) => expect(isAllowedReplicaRequest(u, BASE)).toBe(true));

  it.each([
    `${BASE}/dashboard`,
    `${BASE}/api/approvals`,
    `${BASE}/api/mcp`,
    `${BASE}/assets/x.woff2`, // font extensions are only allowed under /fonts/ and /_next/static/ (M7)
    `${BASE}/reports/x.ttf`,
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

describe("M7 fence hardening", () => {
  type Handler = (...a: never[]) => unknown;
  function fakeContext() {
    const listeners: Record<string, Handler[]> = {};
    const pageListeners: Record<string, Handler[]> = {};
    const closed: string[] = [];
    let wsHandler: ((ws: FakeWs) => void) | undefined;
    const page = {
      on(ev: string, h: Handler) {
        (pageListeners[ev] ??= []).push(h);
      },
      close: async () => void closed.push("page"),
    };
    const ctx = {
      pages: () => [page],
      on(ev: string, h: Handler) {
        (listeners[ev] ??= []).push(h);
      },
      routeWebSocket: async (_pattern: RegExp, h: (ws: FakeWs) => void) => void (wsHandler = h),
    };
    return { ctx, page, listeners, pageListeners, closed, ws: () => wsHandler! };
  }
  interface FakeWs {
    url(): string;
    close(): Promise<void>;
    connectToServer(): unknown;
  }
  const fakeWs = (url: string) => {
    const calls: string[] = [];
    const ws: FakeWs = { url: () => url, close: async () => void calls.push("close"), connectToServer: () => void calls.push("connect") };
    return { ws, calls };
  };

  it("fenceChromiumArgs: DNS and proxy fence for the whole browser (all contexts, workers, sockets)", () => {
    const args = fenceChromiumArgs("http://localhost:3000");
    expect(args).toContain("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1");
    expect(args.some((a) => a.startsWith("--proxy-server="))).toBe(true);
    expect(args.some((a) => a.startsWith("--proxy-bypass-list=") && a.includes("localhost") && a.includes("127.0.0.1"))).toBe(true);
    const deployed = fenceChromiumArgs("https://escheat.example.com");
    expect(deployed.find((a) => a.startsWith("--host-resolver-rules="))).toContain("EXCLUDE escheat.example.com");
    expect(deployed.find((a) => a.startsWith("--proxy-bypass-list="))).toContain("escheat.example.com");
  });

  it("WebSockets: only replica-origin sockets connect; everything else is closed", async () => {
    const m = fakeContext();
    const log = vi.fn();
    await hardenContext(m.ctx, BASE, { log, onViolation: vi.fn() });
    const ok = fakeWs("ws://localhost:3000/replica/ca-holder/socket");
    m.ws()(ok.ws);
    expect(ok.calls).toEqual(["connect"]);
    for (const bad of ["ws://localhost:3000/_next/webpack-hmr", "wss://evil.example/x", "ws://localhost:3000/api/clock"]) {
      const b = fakeWs(bad);
      m.ws()(b.ws);
      expect(b.calls).toEqual(["close"]);
    }
    expect(log).toHaveBeenCalled();
  });

  it("every frame navigation is checked; an off-replica navigation closes the page and reports a violation", async () => {
    const m = fakeContext();
    const onViolation = vi.fn();
    await hardenContext(m.ctx, BASE, { log: vi.fn(), onViolation });
    const nav = (url: string) => (m.pageListeners.framenavigated ?? []).forEach((h) => (h as (f: { url(): string }) => void)({ url: () => url }));
    nav(`${BASE}/replica/ca-holder/dashboard`);
    nav("about:blank");
    nav("chrome-error://chromewebdata/");
    expect(onViolation).not.toHaveBeenCalled();
    nav("https://evil.example/");
    nav(`${BASE}/api/clock`);
    expect(onViolation).toHaveBeenCalledTimes(2);
    expect(onViolation.mock.calls[0]![0]).toContain("evil.example");
  });

  it("new pages and popups get the same navigation watch", async () => {
    const m = fakeContext();
    const onViolation = vi.fn();
    await hardenContext(m.ctx, BASE, { log: vi.fn(), onViolation });
    const popupListeners: Record<string, Handler[]> = {};
    const popup = { on: (ev: string, h: Handler) => void (popupListeners[ev] ??= []).push(h), close: async () => undefined };
    (m.listeners.page ?? []).forEach((h) => (h as (p: typeof popup) => void)(popup));
    (popupListeners.framenavigated ?? []).forEach((h) => (h as (f: { url(): string }) => void)({ url: () => "https://evil.example/popup" }));
    expect(onViolation).toHaveBeenCalledOnce();
  });
});
