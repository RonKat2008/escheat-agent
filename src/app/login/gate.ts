import { randomBytes } from "node:crypto";
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from "@/lib/crypto";

/** Pure passcode-gate logic (used by src/proxy.ts and the login action). */

export const SESSION_COOKIE = "escheat_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const EXEMPT_EXACT_OR_CHILD = ["/login", "/api/inngest", "/api/webhooks", "/owner", "/api/mcp", "/replica", "/_next"];
/**
 * Static assets: only under /fonts/ or as a single root-level file (/favicon.ico, /logo.svg). A file extension on a
 * dynamic path (e.g. /reports/x.txt) is NOT enough to skip the gate (security review M6).
 */
const STATIC_EXT = /\.(ico|png|jpe?g|gif|svg|webp|avif|css|js|map|woff2?|ttf|otf|txt|webmanifest)$/i;

export function isProductionLike(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

export function isExemptPath(pathname: string): boolean {
  if (pathname.includes("..") || /%2e|%5c|%2f|\\/i.test(pathname)) return false;
  if (EXEMPT_EXACT_OR_CHILD.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (!STATIC_EXT.test(pathname)) return false;
  return pathname.startsWith("/fonts/") || /^\/[^/]+$/.test(pathname);
}

/**
 * HMAC key. Derived from the passcode (so changing it revokes every session) plus an optional SESSION_SECRET and
 * SESSION_EPOCH (bump either to revoke all sessions without changing the passcode).
 */
function sessionKey(passcode: string): string {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  const epoch = process.env.SESSION_EPOCH?.trim() ?? "";
  return sha256Hex(`escheat-session-v2:${passcode}:${secret}:${epoch}`);
}

export interface ParsedSession {
  /** Random per-login id (16 hex). Recorded on approvals as "passcode session <first 8>". */
  id: string;
  exp: number;
}

export function createSessionValue(passcode: string, now: number = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS);
  const sid = randomBytes(8).toString("hex");
  return `${exp}.${sid}.${hmacSha256Hex(sessionKey(passcode), `session:${exp}:${sid}`)}`;
}

export function parseSession(value: string | undefined, passcode: string, now: number = Date.now()): ParsedSession | null {
  if (!value) return null;
  const [exp, sid, sig, ...rest] = value.split(".");
  if (!exp || !sid || !sig || rest.length > 0 || !/^\d+$/.test(exp) || !/^[0-9a-f]{16}$/.test(sid)) return null;
  if (!timingSafeEqual(sig, hmacSha256Hex(sessionKey(passcode), `session:${exp}:${sid}`))) return null;
  return Number(exp) > now ? { id: sid, exp: Number(exp) } : null;
}

export function isSessionValid(value: string | undefined, passcode: string, now: number = Date.now()): boolean {
  return parseSession(value, passcode, now) !== null;
}

export function passcodeMatches(input: string, passcode: string): boolean {
  return timingSafeEqual(sha256Hex(input), sha256Hex(passcode));
}

export type GateDecision = "allow" | "redirect_login" | "unauthorized" | "misconfigured";

export function evaluateGate(args: {
  pathname: string;
  cookie: string | undefined;
  passcode: string | undefined;
  now?: number;
  /** Production-like deployment (NODE_ENV=production or VERCEL). Defaults to isProductionLike(). */
  production?: boolean;
}): GateDecision {
  const production = args.production ?? isProductionLike();
  if (!args.passcode) {
    // Dev: gate disabled. Production: FAIL CLOSED (security review H1) except the token-/signature-authenticated surfaces.
    if (!production || isExemptPath(args.pathname)) return "allow";
    return "misconfigured";
  }
  if (isExemptPath(args.pathname)) return "allow";
  if (isSessionValid(args.cookie, args.passcode, args.now)) return "allow";
  return args.pathname.startsWith("/api/") ? "unauthorized" : "redirect_login";
}

/** Only same-site relative paths; blocks open redirects like //evil.com or /\evil.com. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
