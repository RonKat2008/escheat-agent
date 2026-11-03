import { NextResponse } from "next/server";
import { bareStateRedirect } from "@/lib/replica/portal";

/**
 * R3-18: /replica/ca, /replica/de and /replica/tx are route handlers, not pages, so the bare-state redirect no longer
 * throws NEXT_REDIRECT inside the instant-validated [portal] segment (which logged "Could not validate instant" on
 * every hit). Static segments win over [portal], so these never reach the layout. The query string is kept.
 */
export function bareStateHandler(state: string) {
  return function GET(request: Request): NextResponse {
    const target = bareStateRedirect(state);
    const url = new URL(target ?? "/replica/ca-holder", request.url);
    url.search = new URL(request.url).search;
    return NextResponse.redirect(url, 307);
  };
}
