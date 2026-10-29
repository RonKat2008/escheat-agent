import { describe, expect, it } from "vitest";
import {
  EnvError,
  allowedPhones,
  allowedRecipients,
  demoAnchorDate,
  hasAnthropic,
  hasLob,
  isOffline,
  parseEnv,
  staleThresholdDays,
} from "./env";

describe("parseEnv", () => {
  it("does not throw with an empty environment", () => {
    const env = parseEnv({});
    expect(hasAnthropic(env)).toBe(false);
    expect(hasLob(env)).toBe(false);
    expect(isOffline(env)).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ANTHROPIC_API_KEY: "  ", DATABASE_URL: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("detects configured providers", () => {
    const env = parseEnv({ ANTHROPIC_API_KEY: "k", LOB_TEST_API_KEY: "test_x" });
    expect(hasAnthropic(env)).toBe(true);
    expect(hasLob(env)).toBe(true);
  });

  it("parses the offline flag", () => {
    expect(isOffline(parseEnv({ ESCHEAT_OFFLINE: "1" }))).toBe(true);
    expect(isOffline(parseEnv({ ESCHEAT_OFFLINE: "true" }))).toBe(true);
    expect(isOffline(parseEnv({ ESCHEAT_OFFLINE: "0" }))).toBe(false);
  });

  it("splits and lower-cases the recipient allowlist", () => {
    const env = parseEnv({ ALLOWED_TEST_RECIPIENTS: "A@x.com, b@y.com;a@x.com  c@z.com" });
    expect(allowedRecipients(env)).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("returns an empty allowlist when unset", () => {
    expect(allowedRecipients(parseEnv({}))).toEqual([]);
    expect(allowedPhones(parseEnv({}))).toEqual([]);
  });

  it("defaults the stale threshold to 180 days and honours overrides", () => {
    expect(staleThresholdDays(parseEnv({}))).toBe(180);
    expect(staleThresholdDays(parseEnv({ STALE_THRESHOLD_DAYS: "90" }))).toBe(90);
  });

  it("rejects a non-numeric stale threshold", () => {
    expect(() => parseEnv({ STALE_THRESHOLD_DAYS: "abc" })).toThrow(EnvError);
  });

  it("validates the demo anchor date format", () => {
    expect(demoAnchorDate(parseEnv({ DEMO_ANCHOR_DATE: "2026-06-01" }))).toBe("2026-06-01");
    expect(demoAnchorDate(parseEnv({}))).toBeUndefined();
    expect(() => parseEnv({ DEMO_ANCHOR_DATE: "June 1" })).toThrow(EnvError);
  });
});
