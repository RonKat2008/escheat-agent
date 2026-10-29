import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireQbo, requireTokenSecret } from "@/lib/integrations/config";
import { errorResponse } from "@/lib/integrations/http";
import { STATE_COOKIE, verifyState } from "@/lib/integrations/oauth-state";
import { exchangeCode } from "@/lib/integrations/qbo/client";
import { createConnectionStore, drizzleRawStore } from "@/lib/integrations/store";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const cfg = requireQbo();
    const secret = requireTokenSecret("qbo");
    const url = new URL(request.url);
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookie = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${STATE_COOKIE}=`))
      ?.slice(STATE_COOKIE.length + 1);

    const check = verifyState(secret, cookie, url.searchParams.get("state"));
    if (!check.ok) return NextResponse.json({ error: `Invalid OAuth state: ${check.reason}` }, { status: 400 });

    const settings = new URL("/settings/integrations", url);
    if (url.searchParams.get("error")) {
      settings.searchParams.set("qbo", "denied");
      return NextResponse.redirect(settings);
    }
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    if (!code || !realmId) return NextResponse.json({ error: "Missing code or realmId" }, { status: 400 });

    const db = await getDb();
    await exchangeCode(cfg, createConnectionStore(drizzleRawStore(db), secret), { companyId: check.companyId, code, realmId });
    settings.searchParams.set("qbo", "connected");
    const res = NextResponse.redirect(settings);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/integrations/qbo" });
    return res;
  } catch (err) {
    return errorResponse(err, "qbo-callback");
  }
}
