import { NextResponse } from "next/server";

/**
 * Integrations is the only settings surface, so the bare /settings path lands there. A route handler instead of a
 * redirect() page (R3-18): a page that throws NEXT_REDIRECT inside an instant-validated segment logged
 * "Could not validate instant" on every hit. The session gate in src/proxy.ts still runs before this.
 */
export function GET(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/settings/integrations", request.url), 307);
}
