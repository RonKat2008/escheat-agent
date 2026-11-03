import { describe, expect, it } from "vitest";
import { configNamesIn, containsConfigName, ownerLinkNotices, redactSecretValues, toOperatorMessage } from "./operator-copy";

// The two raw warnings R3-14 found in the finance UI (src/lib/letters/compose.ts).
const OWNER_SECRET_RAW = "OWNER_LINK_SECRET is not set; the owner link is signed with a temporary dev secret and stops working when the dev server restarts";
const BASE_URL_RAW = "APP_BASE_URL is not set; the owner link uses the address this app is being served from";

describe("toOperatorMessage", () => {
  it("rewrites the owner-link secret warning in plain words and keeps the raw text as technical detail", () => {
    const m = toOperatorMessage(OWNER_SECRET_RAW);
    expect(containsConfigName(m.plain)).toBe(false);
    expect(m.plain).toMatch(/temporary key/);
    expect(m.technical).toBe(OWNER_SECRET_RAW);
  });

  it("rewrites the base-URL warning", () => {
    const m = toOperatorMessage(BASE_URL_RAW);
    expect(containsConfigName(m.plain)).toBe(false);
    expect(m.plain).toMatch(/public address/);
    expect(m.technical).toContain("APP_BASE_URL");
  });

  it("matches the token-secret error before the owner-link rule it also mentions", () => {
    const m = toOperatorMessage("Token encryption secret not configured (set QBO_TOKEN_SECRET or OWNER_LINK_SECRET)");
    expect(m.plain).toMatch(/encryption key/);
    expect(containsConfigName(m.plain)).toBe(false);
  });

  it.each([
    ["No allowlisted test recipients configured. Set ALLOWED_TEST_RECIPIENTS.", /^Email sending is limited to test addresses\. Add one in Settings → Connections\.$/],
    ["No allowlisted test numbers configured. Set ALLOWED_TEST_PHONES.", /^Calls are limited to test numbers\. Add one in Settings → Connections\.$/],
    ["Set APP_PASSCODE to use this deployment.", /Sign-in isn't set up/],
    ["LOB_TEST_API_KEY must be a test key", /test mode/],
  ])("maps %s", (raw, plain) => {
    const m = toOperatorMessage(raw);
    expect(m.plain).toMatch(plain);
    expect(containsConfigName(m.plain)).toBe(false);
    expect(m.technical).toBe(raw);
  });

  it("falls back to a generic plain sentence for unknown config names", () => {
    const m = toOperatorMessage("SOME_NEW_SETTING is missing");
    expect(containsConfigName(m.plain)).toBe(false);
    expect(m.technical).toBe("SOME_NEW_SETTING is missing");
  });

  it("passes plain operator text through untouched with no technical detail", () => {
    expect(toOperatorMessage("  Incorrect passcode. ")).toEqual({ plain: "Incorrect passcode." });
    expect(toOperatorMessage("Too many attempts. Try again in 30s.").technical).toBeUndefined();
  });

  it("never carries a secret value into the technical detail", () => {
    const m = toOperatorMessage("Bad config: OWNER_LINK_SECRET=hunter2-very-secret-value and PLAID_ENV=sandbox");
    expect(m.technical).not.toContain("hunter2");
    expect(m.technical).toContain("OWNER_LINK_SECRET=(hidden)");
    expect(m.technical).toContain("PLAID_ENV=sandbox");
  });
});

describe("config name helpers", () => {
  it("detects SHOUTY_SNAKE names but not ordinary capitals or codes", () => {
    expect(containsConfigName("Set APP_BASE_URL first")).toBe(true);
    expect(containsConfigName("CA report due. UNVERIFIED. CK13 code.")).toBe(false);
  });

  it("lists names once, in order", () => {
    expect(configNamesIn("A_B then C_D then A_B")).toEqual(["A_B", "C_D"]);
  });

  it("redacts every secret-like assignment", () => {
    expect(redactSecretValues("ANTHROPIC_API_KEY=sk-1 VAPI_API_KEY = abc")).toBe("ANTHROPIC_API_KEY=(hidden) VAPI_API_KEY=(hidden)");
  });
});

describe("ownerLinkNotices", () => {
  it("explains a missing signing key and address in plain words, naming the setting only as configName", () => {
    const [key, addr] = ownerLinkNotices({ secretSet: false, baseUrlSet: false });
    expect(key).toMatchObject({ id: "signing-key", ok: false, configName: "OWNER_LINK_SECRET" });
    expect(addr).toMatchObject({ id: "public-address", ok: false, configName: "APP_BASE_URL" });
    for (const n of [key!, addr!]) {
      expect(containsConfigName(n.plain)).toBe(false);
      expect(containsConfigName(n.title)).toBe(false);
    }
  });

  it("reports both as ready when set", () => {
    expect(ownerLinkNotices({ secretSet: true, baseUrlSet: true }).every((n) => n.ok)).toBe(true);
  });
});
