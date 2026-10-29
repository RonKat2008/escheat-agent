/**
 * CSRF defense for mutating /api/* routes (security review M1). Pure, so it is unit-testable and used by src/proxy.ts.
 *
 * - A browser always sends Origin (and Sec-Fetch-Site) on cross-site POSTs. If either is present it must be same-origin.
 * - A body must be application/json: `text/plain` and form encodings are the "no preflight" cross-site vectors.
 * - Requests with neither header come from non-browser clients (curl, server-to-server). They are not a CSRF vector and
 *   still need the passcode session cookie.
 * Server actions are covered separately by Next's built-in Origin/Host check.
 */

const SELF_AUTHENTICATED = ["/api/webhooks", "/api/inngest", "/api/mcp"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OriginCheckInput {
  method: string;
  pathname: string;
  contentType: string | null;
  hasBody: boolean;
  origin?: string | null;
  secFetchSite?: string | null;
  host?: string | null;
  appBaseUrl?: string | null;
  /** Routes that legitimately accept multipart uploads. */
  multipartRoutes?: string[];
}

export type OriginCheck = { ok: true } | { ok: false; status: 403 | 415; error: string };

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function checkRequestOrigin(i: OriginCheckInput): OriginCheck {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return { ok: true };
  if (!i.pathname.startsWith("/api/")) return { ok: true };
  if (SELF_AUTHENTICATED.some((p) => i.pathname === p || i.pathname.startsWith(`${p}/`))) return { ok: true };

  if (i.origin !== undefined && i.origin !== null) {
    const allowed = new Set<string>();
    const base = originOf(i.appBaseUrl);
    if (base) allowed.add(base);
    if (i.host) for (const scheme of ["http", "https"]) allowed.add(`${scheme}://${i.host}`);
    // Only trust the Host-derived origin when the scheme matches a real browser origin (exact match below).
    if (!allowed.has(i.origin)) return { ok: false, status: 403, error: "Cross-origin request refused" };
  } else if (i.secFetchSite && !["same-origin", "none"].includes(i.secFetchSite)) {
    return { ok: false, status: 403, error: "Cross-site request refused" };
  }

  if (i.hasBody) {
    const ct = (i.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    const multipartOk = ct === "multipart/form-data" && (i.multipartRoutes ?? []).includes(i.pathname);
    if (ct !== "application/json" && !multipartOk) {
      return { ok: false, status: 415, error: "Content-Type must be application/json" };
    }
  }
  return { ok: true };
}
