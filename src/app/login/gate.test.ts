import { describe, expect, it, vi } from "vitest";
import {
  createSessionValue,
  isPublicMarketingPath,
  evaluateGate,
  isProductionLike,
  parseSession,
  isExemptPath,
  isSessionValid,
  passcodeMatches,
  safeNextPath,
  SESSION_TTL_MS,
} from "./gate";

const PASS = "open-sesame";
const now = 1_800_000_000_000;

describe("gate: exemptions", () => {
  it.each([
    "/login",
    "/login/",
    "/api/inngest",
    "/api/webhooks/lob",
    "/api/webhooks/agentmail/x",
    "/owner/abc123",
    "/api/mcp",
    "/replica/ca/login",
    "/_next/static/a.js",
    "/favicon.ico",
    "/logo.svg",
    "/fonts/inter.woff2",
  ])("exempts %s", (p) => expect(isExemptPath(p)).toBe(true));

  it.each([
    "/",
    "/dashboard",
    "/approvals",
    "/api/approvals",
    "/loginx",
    "/login-admin",
    "/api/mcpx",
    "/api/webhooksx",
    "/ownerx",
    "/replicax",
    "/owner/../dashboard",
    "/owner/%2e%2e/dashboard",
    "/replica/..%5cdashboard",
    "/reports/export.pdf",
    "/reports/anything.txt",
    "/api/approvals/x.js",
    "/items/a.css",
    "/replica/../reports/x.txt",
  ])("does not exempt %s", (p) => expect(isExemptPath(p)).toBe(false));
});

describe("gate: sessions", () => {
  it("valid cookie passes until expiry", () => {
    const c = createSessionValue(PASS, now);
    expect(isSessionValid(c, PASS, now + 1000)).toBe(true);
    expect(isSessionValid(c, PASS, now + SESSION_TTL_MS)).toBe(false);
  });
  it("rejects wrong passcode, tamper, garbage, missing", () => {
    const c = createSessionValue(PASS, now);
    expect(isSessionValid(c, "other", now)).toBe(false);
    const [exp, sid, sig] = c.split(".") as [string, string, string];
    expect(isSessionValid(`${Number(exp) + 999999999}.${sid}.${sig}`, PASS, now)).toBe(false);
    expect(isSessionValid(`${exp}.${sid}.${sig.replace(/.$/, "0")}x`, PASS, now)).toBe(false);
    expect(isSessionValid(`${exp}.othersid.${sig}`, PASS, now)).toBe(false);
    for (const g of ["", "x", "1.2.3", ".", "abc.def", undefined]) expect(isSessionValid(g, PASS, now)).toBe(false);
  });
  it("parseSession exposes a short session id", () => {
    const c = createSessionValue(PASS, now);
    expect(parseSession(c, PASS, now)?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(parseSession(c, "other", now)).toBeNull();
    expect(createSessionValue(PASS, now)).not.toBe(c); // random id per login
  });
  it("changing SESSION_EPOCH or SESSION_SECRET revokes existing sessions", () => {
    const c = createSessionValue(PASS, now);
    vi.stubEnv("SESSION_EPOCH", "2");
    expect(isSessionValid(c, PASS, now)).toBe(false);
    vi.unstubAllEnvs();
    vi.stubEnv("SESSION_SECRET", "rotated");
    expect(isSessionValid(c, PASS, now)).toBe(false);
    vi.unstubAllEnvs();
    expect(isSessionValid(c, PASS, now)).toBe(true);
  });
  it("passcodeMatches is exact", () => {
    expect(passcodeMatches(PASS, PASS)).toBe(true);
    expect(passcodeMatches(`${PASS} `, PASS)).toBe(false);
    expect(passcodeMatches("", PASS)).toBe(false);
  });
});

describe("evaluateGate", () => {
  const cookie = createSessionValue(PASS, now);
  it("is disabled when no passcode is set", () => {
    expect(evaluateGate({ pathname: "/dashboard", cookie: undefined, passcode: undefined })).toBe("allow");
  });
  it("FAILS CLOSED in production when APP_PASSCODE is unset (H1)", () => {
    for (const p of ["/approvals", "/api/outreach/x/approve", "/api/clock", "/api/agents/file", "/reports/x.txt"]) {
      expect(evaluateGate({ pathname: p, cookie: undefined, passcode: undefined, production: true })).toBe("misconfigured");
    }
    for (const p of ["/", "/how-it-works", "/security"]) {
      expect(evaluateGate({ pathname: p, cookie: undefined, passcode: undefined, production: true })).toBe("allow");
    }
    for (const p of ["/replica/ca/login", "/owner/tok", "/api/webhooks/lob", "/api/inngest", "/_next/static/a.js", "/favicon.ico", "/login"]) {
      expect(evaluateGate({ pathname: p, cookie: undefined, passcode: undefined, production: true })).toBe("allow");
    }
  });
  it("MCP is not gate-exempt-by-accident: it is exempt only because it has its own bearer auth", () => {
    expect(evaluateGate({ pathname: "/api/mcp", cookie: undefined, passcode: undefined, production: true })).toBe("allow");
  });
  it("isProductionLike reads NODE_ENV and VERCEL", () => {
    expect(isProductionLike({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionLike({ VERCEL: "1" })).toBe(true);
    expect(isProductionLike({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionLike({})).toBe(false);
  });
  it("redirects pages and 401s APIs without a session", () => {
    expect(evaluateGate({ pathname: "/dashboard", cookie: undefined, passcode: PASS, now })).toBe("redirect_login");
    expect(evaluateGate({ pathname: "/api/approvals", cookie: undefined, passcode: PASS, now })).toBe("unauthorized");
  });
  it("allows with a valid cookie, rejects an expired or forged one", () => {
    expect(evaluateGate({ pathname: "/dashboard", cookie, passcode: PASS, now })).toBe("allow");
    expect(evaluateGate({ pathname: "/dashboard", cookie, passcode: PASS, now: now + SESSION_TTL_MS })).toBe(
      "redirect_login",
    );
    expect(evaluateGate({ pathname: "/dashboard", cookie: "9999999999999.deadbeef", passcode: PASS, now })).toBe(
      "redirect_login",
    );
  });
  it("exempt paths pass without a cookie", () => {
    for (const p of ["/login", "/replica/ca/x", "/owner/t", "/api/mcp", "/api/inngest", "/api/webhooks/lob"]) {
      expect(evaluateGate({ pathname: p, cookie: undefined, passcode: PASS, now })).toBe("allow");
    }
  });
});

describe("safeNextPath", () => {
  it("only permits local relative paths", () => {
    expect(safeNextPath("/items?x=1")).toBe("/items?x=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("public marketing allowlist", () => {
  const gate = (pathname: string) => evaluateGate({ pathname, cookie: undefined, passcode: PASS, now });

  it.each(["/", "/how-it-works", "/security", "/security/", "/how-it-works/"])("serves %s without a session", (p) => {
    expect(isPublicMarketingPath(p)).toBe(true);
    expect(gate(p)).toBe("allow");
  });

  it.each([
    "/dashboard",
    "/approvals",
    "/items",
    "/reports",
    "/rules",
    "/settings",
    "/eval",
    "/chat",
    "/product",
  ])("keeps %s gated", (p) => expect(gate(p)).toBe("redirect_login"));

  it.each(["/api/approvals", "/api/clock", "/api/agents/file", "/api/ingest", "/api/reports/x"])("keeps %s gated (401)", (p) =>
    expect(gate(p)).toBe("unauthorized"),
  );

  it.each([
    "/product/../dashboard",
    "/security/../dashboard",
    "//dashboard",
    "//",
    "/%2e%2e/dashboard",
    "/security/%2e%2e/dashboard",
    "/security%2f..%2fdashboard",
    "/security/..%5cdashboard",
    "/security/x",
    "/how-it-works/anything",
    "/security-admin",
    "/securityx",
    "/Security",
    "/security//",
    "//security",
    "/ /security",
  ])("path trick %s does not bypass the gate", (p) => {
    expect(isPublicMarketingPath(p)).toBe(false);
    expect(gate(p)).toBe("redirect_login");
  });

  it("marketing stays public in production without a passcode, everything else fails closed", () => {
    expect(evaluateGate({ pathname: "/security", cookie: undefined, passcode: undefined, production: true })).toBe("allow");
    expect(evaluateGate({ pathname: "/dashboard", cookie: undefined, passcode: undefined, production: true })).toBe("misconfigured");
    expect(evaluateGate({ pathname: "/api/approvals", cookie: undefined, passcode: undefined, production: true })).toBe("misconfigured");
  });
});
