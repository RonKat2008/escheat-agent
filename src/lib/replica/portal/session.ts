import { z } from "zod";
import { fromBase64Url, hmacSha256Hex, timingSafeEqual, toBase64Url } from "@/lib/crypto";
import { REPLICA_STATES } from "./portals";

/** Fake, published-on-the-page credentials. They protect nothing real. */
export const REPLICA_USERNAME = "northwind-demo";
export const REPLICA_PASSWORD = "replica-only";

export const REPLICA_COOKIE = "replica_session";
export const REPLICA_COOKIE_PATH = "/replica";
export const SESSION_TTL_SECONDS = 60 * 60 * 2;

const FALLBACK_SECRET = "replica-demo-secret-not-a-real-secret";
const secret = () => process.env.REPLICA_SESSION_SECRET?.trim() || FALLBACK_SECRET;

export const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

export function checkCredentials(input: unknown): boolean {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return false;
  const userOk = timingSafeEqual(parsed.data.username, REPLICA_USERNAME);
  const passOk = timingSafeEqual(parsed.data.password, REPLICA_PASSWORD);
  return userOk && passOk;
}

const payloadSchema = z.object({
  u: z.string(),
  st: z.enum(REPLICA_STATES),
  exp: z.number().int(),
});
export type SessionPayload = z.infer<typeof payloadSchema>;

export function createSessionToken(
  username: string,
  state: (typeof REPLICA_STATES)[number],
  nowMs: number = Date.now(),
): string {
  const payload: SessionPayload = { u: username, st: state, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const body = toBase64Url(JSON.stringify(payload));
  return `${body}.${hmacSha256Hex(secret(), body)}`;
}

/** Returns the payload for a valid, unexpired, untampered token; otherwise null. */
export function verifySessionToken(
  token: string | undefined,
  nowMs: number = Date.now(),
): SessionPayload | null {
  if (!token || token.length > 2000) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeEqual(sig, hmacSha256Hex(secret(), body))) return null;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(fromBase64Url(body).toString("utf8")));
    if (!parsed.success) return null;
    if (parsed.data.exp * 1000 <= nowMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
