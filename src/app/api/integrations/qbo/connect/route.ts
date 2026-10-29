import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireQbo, requireTokenSecret } from "@/lib/integrations/config";
import { errorResponse, resolveCompanyId } from "@/lib/integrations/http";
import { issueState, STATE_COOKIE } from "@/lib/integrations/oauth-state";
import { authorizeUrl } from "@/lib/integrations/qbo/client";
import { sessionGuard } from "@/lib/auth/session";

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const cfg = requireQbo();
    const secret = requireTokenSecret("qbo");
    const url = new URL(request.url);
    const companyId = await resolveCompanyId(await getDb(), url.searchParams.get("companyId"));
    if (!companyId) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    const { state, cookie } = issueState(secret, companyId);
    const res = NextResponse.redirect(authorizeUrl(cfg, state));
    res.cookies.set(STATE_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/integrations/qbo",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    return errorResponse(err, "qbo-connect");
  }
}
