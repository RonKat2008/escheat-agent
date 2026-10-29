import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, tokenSecretFromEnv, TokenCryptoError } from "./token-crypto";

describe("token encryption", () => {
  it("round-trips and uses a fresh IV per call", () => {
    const a = encryptToken("refresh-token-123", "secret");
    const b = encryptToken("refresh-token-123", "secret");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token-123");
    expect(decryptToken(a, "secret")).toBe("refresh-token-123");
  });

  it("rejects a tampered ciphertext, tag, or wrong secret", () => {
    const [v, iv, tag, ct] = encryptToken("abc", "secret").split(".") as [string, string, string, string];
    const flip = (s: string) => (s.startsWith("A") ? "B" : "A") + s.slice(1);
    expect(() => decryptToken([v, iv, tag, flip(ct)].join("."), "secret")).toThrow(TokenCryptoError);
    expect(() => decryptToken([v, iv, flip(tag), ct].join("."), "secret")).toThrow(TokenCryptoError);
    expect(() => decryptToken([v, iv, tag, ct].join("."), "other")).toThrow(TokenCryptoError);
    expect(() => decryptToken("garbage", "secret")).toThrow(TokenCryptoError);
  });

  it("prefers QBO_TOKEN_SECRET over OWNER_LINK_SECRET", () => {
    expect(tokenSecretFromEnv({ QBO_TOKEN_SECRET: "a", OWNER_LINK_SECRET: "b" })).toBe("a");
    expect(tokenSecretFromEnv({ OWNER_LINK_SECRET: "b" })).toBe("b");
    expect(tokenSecretFromEnv({})).toBeUndefined();
  });
});
