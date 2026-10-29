import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { fromBase64Url, hmacSha256, sha256Hex, timingSafeEqual, toBase64Url } from "@/lib/crypto";

/**
 * Owner response links. Token = base64url(JSON payload) "." base64url(HMAC-SHA256).
 * Only sha256(token) is stored (outreach.token_hash). The schema has no "used" column,
 * so `outreach.responded_at` being non-null is the single-use marker.
 */

export const MIN_SECRET_LENGTH = 16;

export class OwnerTokenConfigError extends Error {
  constructor() {
    super(`OWNER_LINK_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters.`);
    this.name = "OwnerTokenConfigError";
  }
}

export type OwnerTokenFailure = "malformed" | "bad_signature" | "expired" | "already_used" | "unknown_token";

export class OwnerTokenError extends Error {
  constructor(public readonly reason: OwnerTokenFailure) {
    super(`Owner link rejected: ${reason}`);
    this.name = "OwnerTokenError";
  }
}

export interface OwnerTokenPayload {
  outreachId: string;
  /** epoch milliseconds */
  exp: number;
}

function secretOrThrow(secret: string | undefined): string {
  const s = secret ?? process.env.OWNER_LINK_SECRET?.trim();
  if (!s || s.length < MIN_SECRET_LENGTH) throw new OwnerTokenConfigError();
  return s;
}

export function hashOwnerToken(token: string): string {
  return sha256Hex(token);
}

export function createOwnerToken(
  args: { outreachId: string; expiresAt: Date },
  secret?: string,
): { token: string; tokenHash: string } {
  const key = secretOrThrow(secret);
  const exp = args.expiresAt.getTime();
  if (!Number.isFinite(exp)) throw new Error("createOwnerToken: invalid expiresAt");
  const body = toBase64Url(JSON.stringify({ oid: args.outreachId, exp }));
  const sig = toBase64Url(hmacSha256(key, body));
  const token = `${body}.${sig}`;
  return { token, tokenHash: hashOwnerToken(token) };
}

/** Throws OwnerTokenError (malformed | bad_signature | expired) or OwnerTokenConfigError. */
export function verifyOwnerToken(token: string, now: Date = new Date(), secret?: string): OwnerTokenPayload {
  const key = secretOrThrow(secret);
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new OwnerTokenError("malformed");
  const [body, sig] = parts as [string, string];
  if (!timingSafeEqual(sig, toBase64Url(hmacSha256(key, body)))) {
    throw new OwnerTokenError("bad_signature");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(body).toString("utf8"));
  } catch {
    throw new OwnerTokenError("malformed");
  }
  const p = parsed as { oid?: unknown; exp?: unknown };
  if (typeof p?.oid !== "string" || typeof p.exp !== "number") throw new OwnerTokenError("malformed");
  if (now.getTime() >= p.exp) throw new OwnerTokenError("expired");
  return { outreachId: p.oid, exp: p.exp };
}

/**
 * Verify signature + expiry, then check the DB: the stored token_hash must match
 * this token and the outreach must not already have a response. Does NOT consume.
 */
export async function assertOwnerTokenUsable(
  db: Db,
  token: string,
  now: Date = new Date(),
  secret?: string,
): Promise<OwnerTokenPayload> {
  const payload = verifyOwnerToken(token, now, secret);
  const [row] = await db.select().from(outreach).where(eq(outreach.id, payload.outreachId));
  if (!row?.tokenHash || !timingSafeEqual(row.tokenHash, hashOwnerToken(token))) {
    throw new OwnerTokenError("unknown_token");
  }
  if (row.respondedAt !== null) throw new OwnerTokenError("already_used");
  return payload;
}

/** Atomically mark the link used (sets responded_at where null). Second call throws already_used. */
export async function markOwnerTokenUsed(db: Db, outreachId: string, now: Date = new Date()): Promise<void> {
  const rows = await db
    .update(outreach)
    .set({ respondedAt: now })
    .where(and(eq(outreach.id, outreachId), isNull(outreach.respondedAt)))
    .returning({ id: outreach.id });
  if (rows.length === 0) throw new OwnerTokenError("already_used");
}
