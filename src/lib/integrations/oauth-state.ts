import { randomBytes } from "node:crypto";
import { fromBase64Url, hmacSha256Hex, timingSafeEqual, toBase64Url } from "@/lib/crypto";

export const STATE_COOKIE = "escheat_qbo_state";
const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  n: string; // nonce (also sent as the OAuth `state` param)
  c: string; // company id the flow was started for
  exp: number;
}

export interface IssuedState {
  /** value for the OAuth `state` query param */
  state: string;
  /** value for the signed cookie */
  cookie: string;
}

const sign = (secret: string, body: string) => hmacSha256Hex(`oauth-state:${secret}`, body);

export function issueState(secret: string, companyId: string, now: number = Date.now()): IssuedState {
  const payload: StatePayload = { n: randomBytes(18).toString("base64url"), c: companyId, exp: now + STATE_TTL_MS };
  const body = toBase64Url(JSON.stringify(payload));
  return { state: payload.n, cookie: `${body}.${sign(secret, body)}` };
}

export type StateCheck = { ok: true; companyId: string } | { ok: false; reason: string };

/** CSRF check: the callback's `state` must match the nonce inside the validly signed, unexpired cookie. */
export function verifyState(
  secret: string,
  cookie: string | undefined,
  state: string | null,
  now: number = Date.now(),
): StateCheck {
  if (!cookie || !state) return { ok: false, reason: "missing state" };
  const [body, sig, ...rest] = cookie.split(".");
  if (!body || !sig || rest.length > 0) return { ok: false, reason: "malformed state cookie" };
  if (!timingSafeEqual(sig, sign(secret, body))) return { ok: false, reason: "bad state signature" };
  let payload: StatePayload;
  try {
    payload = JSON.parse(fromBase64Url(body).toString("utf8")) as StatePayload;
  } catch {
    return { ok: false, reason: "malformed state cookie" };
  }
  if (typeof payload.n !== "string" || typeof payload.c !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed state cookie" };
  }
  if (payload.exp <= now) return { ok: false, reason: "state expired" };
  if (!timingSafeEqual(payload.n, state)) return { ok: false, reason: "state mismatch" };
  return { ok: true, companyId: payload.c };
}
