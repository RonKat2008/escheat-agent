import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import {
  assertAllowedEmail,
  assertAllowedPhone,
  assertLobTestKey,
  LiveLobKeyError,
  normalizePhone,
  RecipientNotAllowedError,
} from "./allowlist";

const env = (o: Record<string, string>) => parseEnv(o);

describe("assertAllowedEmail", () => {
  const e = env({ ALLOWED_TEST_RECIPIENTS: "Ronit@Example.com, second@test.dev" });
  it("matches case-insensitively after trim", () => {
    expect(assertAllowedEmail("  RONIT@example.COM ", e)).toBe("ronit@example.com");
    expect(assertAllowedEmail("second@test.dev", e)).toBe("second@test.dev");
  });
  it("blocks everything with an empty or unset list", () => {
    expect(() => assertAllowedEmail("ronit@example.com", env({}))).toThrow(RecipientNotAllowedError);
    expect(() => assertAllowedEmail("ronit@example.com", env({ ALLOWED_TEST_RECIPIENTS: "  " }))).toThrow(
      RecipientNotAllowedError,
    );
  });
  it.each([
    "ronit+x@example.com",
    "ronit@example.com.evil.io",
    "evil@example.com",
    "ronit@example.com, evil@x.com",
    "Ronit <ronit@example.com>",
    "ronit@example.com;evil@x.com",
    "",
    "   ",
    "ronit@@example.com",
    "xronit@example.com",
  ])("rejects %j", (addr) => {
    expect(() => assertAllowedEmail(addr, e)).toThrow(RecipientNotAllowedError);
  });
});

describe("assertAllowedPhone", () => {
  const e = env({ ALLOWED_TEST_PHONES: "+1 (415) 555-0100, 5125550199" });
  it("normalizes formats to E.164", () => {
    expect(assertAllowedPhone("415-555-0100", e)).toBe("+14155550100");
    expect(assertAllowedPhone("+14155550100", e)).toBe("+14155550100");
    expect(assertAllowedPhone("(512) 555 0199", e)).toBe("+15125550199");
  });
  it("blocks all when list empty", () => {
    expect(() => assertAllowedPhone("+14155550100", env({}))).toThrow(RecipientNotAllowedError);
  });
  it.each(["+14155550101", "", "abc", "415555010", "+44 415 555 0100", "911"])("rejects %j", (n) => {
    expect(() => assertAllowedPhone(n, e)).toThrow(RecipientNotAllowedError);
  });
  it("normalizePhone rejects garbage", () => {
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("assertLobTestKey", () => {
  it("accepts test keys", () => {
    expect(assertLobTestKey("test_abc123")).toBe("test_abc123");
  });
  it.each([undefined, null, "", "live_abc", "TEST_abc", " test_abc", "test_", "xtest_abc", "pk_test_abc"])(
    "rejects %j",
    (k) => {
      expect(() => assertLobTestKey(k as string)).toThrow(LiveLobKeyError);
    },
  );
});
