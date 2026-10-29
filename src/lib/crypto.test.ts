import { describe, expect, it } from "vitest";
import { canonicalJson, hmacSha256Hex, sha256Hex, timingSafeEqual } from "./crypto";

describe("crypto", () => {
  it("canonicalJson is key-order independent and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: undefined, b: [3, undefined] } })).toBe(
      '{"a":{"b":[3,null],"d":1},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("rejects NaN, bigint, circular", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: 1n })).toThrow();
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(() => canonicalJson(c)).toThrow(/circular/);
  });
  it("shared (non-circular) refs are fine; dates are ISO", () => {
    const s = { x: 1 };
    expect(canonicalJson({ a: s, b: s, d: new Date("2025-01-02T00:00:00Z") })).toBe(
      '{"a":{"x":1},"b":{"x":1},"d":"2025-01-02T00:00:00.000Z"}',
    );
  });
  it("sha256/hmac known vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
  it("timingSafeEqual handles unequal lengths", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
