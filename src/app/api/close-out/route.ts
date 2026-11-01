import { NextResponse } from "next/server";
import { sessionGuard } from "@/lib/auth/session";
import { buildClosePlan, ClosePlanError } from "@/lib/close-out/plan";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";

/** GET /api/close-out?state=CA: the close-out plan as JSON (read-only, same builder as the chat tool). */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const state = new URL(request.url).searchParams.get("state") ?? "";
  try {
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    return NextResponse.json({ plan: await buildClosePlan(db, companyId, state) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ClosePlanError) return NextResponse.json({ error: err.message, code: "invalid_state" }, { status: 400 });
    console.error("[close-out] plan failed", err);
    return NextResponse.json({ error: "Could not build the plan." }, { status: 500 });
  }
}
