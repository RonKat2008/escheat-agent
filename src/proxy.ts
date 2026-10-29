import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { evaluateGate, SESSION_COOKIE } from "@/app/login/gate";

/** Passcode gate. Disabled when APP_PASSCODE is unset. Logic lives in src/app/login/gate.ts. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = evaluateGate({
    pathname,
    cookie: request.cookies.get(SESSION_COOKIE)?.value,
    passcode: process.env.APP_PASSCODE?.trim() || undefined,
  });
  if (decision === "allow") return NextResponse.next();
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "Passcode session required" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
