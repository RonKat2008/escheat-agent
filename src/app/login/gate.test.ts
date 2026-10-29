import { describe, expect, it } from "vitest";
import {
  createSessionValue,
  evaluateGate,
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
    "/api/webhooks/resend/x",
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
    const [exp, sig] = c.split(".") as [string, string];
    expect(isSessionValid(`${Number(exp) + 999999999}.${sig}`, PASS, now)).toBe(false);
    expect(isSessionValid(`${exp}.${sig.replace(/.$/, "0")}x`, PASS, now)).toBe(false);
    for (const g of ["", "x", "1.2.3", ".", "abc.def", undefined]) expect(isSessionValid(g, PASS, now)).toBe(false);
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
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
