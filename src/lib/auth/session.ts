import { NextResponse } from "next/server";
import { isProductionLike, parseSession, SESSION_COOKIE } from "@/app/login/gate";

/**
 * Defense-in-depth session check (security review M6). src/proxy.ts is the first layer; every mutating route handler
 * and server action calls this too, so a proxy bypass / future exempt-path mistake cannot expose an action.
 * Fails CLOSED in production-like deployments when APP_PASSCODE is unset (H1).
 */

export interface Session {
  /** Random per-login id from the signed cookie; "dev" when the gate is disabled. */
  id: string;
  gateDisabled: boolean;
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const MISSING_PASSCODE_MESSAGE = "Set APP_PASSCODE to use this deployment.";

function cookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Pass the Request in route handlers; omit it in server actions (reads the cookie store). */
export async function requireSession(request?: Request): Promise<Session> {
  const passcode = process.env.APP_PASSCODE?.trim() || undefined;
  if (!passcode) {
    if (isProductionLike()) throw new AuthError(503, MISSING_PASSCODE_MESSAGE);
    return { id: "dev", gateDisabled: true };
  }
  let value: string | undefined;
  if (request) value = cookieFromHeader(request.headers.get("cookie"), SESSION_COOKIE);
  else {
    const { cookies } = await import("next/headers");
    value = (await cookies()).get(SESSION_COOKIE)?.value;
  }
  const parsed = parseSession(value, passcode);
  if (!parsed) throw new AuthError(401, "Passcode session required");
  return { id: parsed.id, gateDisabled: false };
}

/** Route-handler helper: returns the denial response, or null when the caller may proceed. */
export async function sessionGuard(request?: Request): Promise<NextResponse | null> {
  try {
    await requireSession(request);
    return null;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Maps a thrown AuthError (from requireSession) to its response; rethrows anything else. */
export function authErrorResponse(e: unknown): NextResponse {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

/**
 * True when the passcode gate is off (local dev with no APP_PASSCODE). Approvals then are not tied to a signed-in
 * session; the UI must say so before anyone approves (F18), rather than only recording it.
 */
export function isGateDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return !env.APP_PASSCODE?.trim() && !isProductionLike(env);
}

/**
 * Older approval rows carried this after the name. R6-10: approverLabel no longer appends it; "no sign-in configured"
 * is a separate fact where it matters (the filing record's `signIn`). Kept exported for callers that reference it.
 */
export const GATE_DISABLED_SUFFIX = "(local dev, gate disabled)";

/**
 * What is recorded on the approval row: the typed name, plus the passcode session when there is one. With no sign-in
 * configured (local dev) it is just the name. Displays use approverName() (lib/auth/approver.ts), which shows the name only.
 */
export function approverLabel(session: Session, typedName: string): string {
  const name = typedName.trim().slice(0, 80);
  if (!name) throw new Error("approver_required: a typed approver name is required");
  return session.gateDisabled ? name : `${name} (passcode session ${session.id.slice(0, 8)})`;
}

/** R6-10: how the approver was identified, recorded separately from the name. */
export const signInOf = (session: Session): "passcode" | "none_configured" => (session.gateDisabled ? "none_configured" : "passcode");
