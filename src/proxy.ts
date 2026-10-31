import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRequestOrigin } from "@/lib/auth/csrf";
import { MISSING_PASSCODE_MESSAGE } from "@/lib/auth/session";
import { evaluateGate, SESSION_COOKIE } from "@/app/login/gate";

/**
 * First layer: passcode gate + CSRF checks. Logic lives in src/app/login/gate.ts and src/lib/auth/csrf.ts.
 * The gate is disabled in development when APP_PASSCODE is unset and FAILS CLOSED in production (H1).
 * Route handlers and server actions re-check the session themselves (requireSession, M6).
 */
function misconfiguredResponse(pathname: string): NextResponse {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: MISSING_PASSCODE_MESSAGE }, { status: 503 });
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Passcode required</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#f4f6fa;background:#000}code{background:#151821;padding:.1rem .35rem;border-radius:.25rem}</style></head><body><h1>Passcode required</h1><p>${MISSING_PASSCODE_MESSAGE}</p><p>This deployment refuses to serve the app until <code>APP_PASSCODE</code> is configured, so no approval gate is ever left open to the internet.</p></body></html>`;
  return new NextResponse(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = evaluateGate({
    pathname,
    cookie: request.cookies.get(SESSION_COOKIE)?.value,
    passcode: process.env.APP_PASSCODE?.trim() || undefined,
  });
  if (decision === "misconfigured") return misconfiguredResponse(pathname);
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "Passcode session required" }, { status: 401 });
  }
  if (decision === "redirect_login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const csrf = checkRequestOrigin({
    method: request.method,
    pathname,
    contentType: request.headers.get("content-type"),
    // A request that declares a Content-Type or chunked encoding has a body even without Content-Length (h2, streaming).
    hasBody: request.headers.has("content-length")
      ? request.headers.get("content-length") !== "0"
      : request.headers.has("transfer-encoding") || request.headers.has("content-type"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    appBaseUrl: process.env.APP_BASE_URL,
  });
  if (!csrf.ok) return NextResponse.json({ error: csrf.error }, { status: csrf.status });
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
