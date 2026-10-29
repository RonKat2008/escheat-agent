import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/** Secret used to encrypt stored integration tokens: QBO_TOKEN_SECRET, falling back to OWNER_LINK_SECRET. */
export function tokenSecretFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const v = env.QBO_TOKEN_SECRET?.trim() || env.OWNER_LINK_SECRET?.trim();
  return v || undefined;
}

function deriveKey(secret: string): Buffer {
  if (!secret) throw new TokenCryptoError("token secret is empty");
  return Buffer.from(hkdfSync("sha256", secret, "escheat-integrations", "token-encryption-v1", 32));
}

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptToken(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Throws TokenCryptoError on malformed input, wrong key, or tampering. */
export function decryptToken(payload: string, secret: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new TokenCryptoError("malformed token payload");
  const [, iv, tag, ct] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("token payload failed authentication");
  }
}
