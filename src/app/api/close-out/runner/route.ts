import { NextResponse } from "next/server";
import { sessionGuard } from "@/lib/auth/session";
import { ClosePlanError } from "@/lib/close-out/plan";
import { buildRunner } from "@/lib/close-out/runner";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";

/** GET /api/close-out/runner?state=TX: the close-out runner's steps as JSON (read-only; the page re-reads it after each action). */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const state = new URL(request.url).searchParams.get("state") ?? "";
  try {
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    return NextResponse.json({ runner: await buildRunner(db, companyId, state) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ClosePlanError) return NextResponse.json({ error: err.message, code: "invalid_state" }, { status: 400 });
    console.error("[close-out] runner failed", err);
    return NextResponse.json({ error: "Could not build the close-out runner." }, { status: 500 });
  }
}
