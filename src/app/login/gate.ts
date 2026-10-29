import { hmacSha256Hex, sha256Hex, timingSafeEqual } from "@/lib/crypto";

/** Pure passcode-gate logic (used by src/proxy.ts and the login action). */

export const SESSION_COOKIE = "escheat_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const EXEMPT_EXACT_OR_CHILD = ["/login", "/api/inngest", "/api/webhooks", "/owner", "/api/mcp", "/replica", "/_next"];
const STATIC_FILE = /\.(ico|png|jpe?g|gif|svg|webp|avif|css|js|map|woff2?|ttf|otf|txt|webmanifest)$/i;

export function isExemptPath(pathname: string): boolean {
  if (pathname.includes("..") || /%2e|%5c|\\/i.test(pathname)) return false;
  if (EXEMPT_EXACT_OR_CHILD.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  return STATIC_FILE.test(pathname);
}

function sessionKey(passcode: string): string {
  return sha256Hex(`escheat-session-v1:${passcode}`);
}

export function createSessionValue(passcode: string, now: number = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${hmacSha256Hex(sessionKey(passcode), `session:${exp}`)}`;
}

export function isSessionValid(value: string | undefined, passcode: string, now: number = Date.now()): boolean {
  if (!value) return false;
  const [exp, sig, ...rest] = value.split(".");
  if (!exp || !sig || rest.length > 0 || !/^\d+$/.test(exp)) return false;
  if (!timingSafeEqual(sig, hmacSha256Hex(sessionKey(passcode), `session:${exp}`))) return false;
  return Number(exp) > now;
}

export function passcodeMatches(input: string, passcode: string): boolean {
  return timingSafeEqual(sha256Hex(input), sha256Hex(passcode));
}

export type GateDecision = "allow" | "redirect_login" | "unauthorized";

export function evaluateGate(args: {
  pathname: string;
  cookie: string | undefined;
  passcode: string | undefined;
  now?: number;
}): GateDecision {
  if (!args.passcode) return "allow"; // gate disabled (dev)
  if (isExemptPath(args.pathname)) return "allow";
  if (isSessionValid(args.cookie, args.passcode, args.now)) return "allow";
  return args.pathname.startsWith("/api/") ? "unauthorized" : "redirect_login";
}

/** Only same-site relative paths; blocks open redirects like //evil.com or /\evil.com. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
