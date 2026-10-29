import { describe, expect, it } from "vitest";
import { checkRequestOrigin } from "./csrf";

const base = { method: "POST", pathname: "/api/clock", host: "localhost:3000", appBaseUrl: "http://localhost:3000" };
const json = { contentType: "application/json", hasBody: true };

describe("checkRequestOrigin (M1)", () => {
  it("allows same-origin JSON posts", () => {
    expect(checkRequestOrigin({ ...base, ...json, origin: "http://localhost:3000" })).toEqual({ ok: true });
    expect(checkRequestOrigin({ ...base, ...json, origin: "http://localhost:3000", secFetchSite: "same-origin" }).ok).toBe(true);
    expect(checkRequestOrigin({ ...base, contentType: "application/json; charset=utf-8", hasBody: true }).ok).toBe(true); // non-browser client
  });
  it("rejects text/plain and form content types (cross-site form CSRF)", () => {
    for (const ct of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", null]) {
      const r = checkRequestOrigin({ ...base, contentType: ct, hasBody: true, origin: "http://localhost:3000" });
      expect(r).toMatchObject({ ok: false, status: 415 });
    }
  });
  it("rejects a foreign or null Origin and cross-site Sec-Fetch-Site", () => {
    expect(checkRequestOrigin({ ...base, ...json, origin: "https://evil.example" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequestOrigin({ ...base, ...json, origin: "null" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequestOrigin({ ...base, ...json, secFetchSite: "cross-site" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequestOrigin({ ...base, ...json, secFetchSite: "same-site" })).toMatchObject({ ok: false, status: 403 });
  });
  it("accepts the deployed APP_BASE_URL origin even when Host differs (proxy)", () => {
    expect(
      checkRequestOrigin({ ...base, ...json, host: "internal:8080", appBaseUrl: "https://escheat.example", origin: "https://escheat.example" }).ok,
    ).toBe(true);
  });
  it("body-less posts still need a same-origin Origin when a browser sends one", () => {
    expect(checkRequestOrigin({ ...base, contentType: null, hasBody: false, origin: "https://evil.example" }).ok).toBe(false);
    expect(checkRequestOrigin({ ...base, contentType: null, hasBody: false }).ok).toBe(true);
  });
  it("does not apply to safe methods or self-authenticated routes", () => {
    expect(checkRequestOrigin({ ...base, method: "GET", origin: "https://evil.example", contentType: null, hasBody: false }).ok).toBe(true);
    for (const p of ["/api/webhooks/lob", "/api/inngest", "/api/mcp"]) {
      expect(checkRequestOrigin({ ...base, pathname: p, contentType: "text/plain", hasBody: true, origin: "https://x" }).ok).toBe(true);
    }
    expect(checkRequestOrigin({ ...base, pathname: "/owner/abc", contentType: "text/plain", hasBody: true }).ok).toBe(true);
  });
});
