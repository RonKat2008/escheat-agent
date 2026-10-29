import { createHash, createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit, `undefined` object
 * members dropped, `undefined`/function array slots become null (as JSON.stringify),
 * Dates become ISO strings. Non-finite numbers and bigints throw (no silent lossy hashes).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set())) ?? "null";
}

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return value;
    case "bigint":
      throw new TypeError("canonicalJson: bigint is not supported");
    case "undefined":
    case "function":
    case "symbol":
      return null;
  }
  const obj = value as object;
  if (obj instanceof Date) {
    if (Number.isNaN(obj.getTime())) throw new TypeError("canonicalJson: invalid Date");
    return obj.toISOString();
  }
  if (seen.has(obj)) throw new TypeError("canonicalJson: circular structure");
  seen.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map((v) => normalize(v, seen));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = (obj as Record<string, unknown>)[key];
      if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
      out[key] = normalize(v, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256(secret: string | Uint8Array, data: string | Uint8Array): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function hmacSha256Hex(secret: string | Uint8Array, data: string | Uint8Array): string {
  return hmacSha256(secret, data).toString("hex");
}

/** Constant-time string/buffer comparison that is safe for unequal lengths (returns false). */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const ba = typeof a === "string" ? Buffer.from(a) : Buffer.from(a);
  const bb = typeof b === "string" ? Buffer.from(b) : Buffer.from(b);
  if (ba.length !== bb.length) {
    // still burn a comparison so timing does not reveal length match
    nodeTimingSafeEqual(ba, ba);
    return false;
  }
  return nodeTimingSafeEqual(ba, bb);
}

export const toBase64Url = (buf: Uint8Array | string): string =>
  Buffer.from(buf).toString("base64url");

export const fromBase64Url = (s: string): Buffer => Buffer.from(s, "base64url");
