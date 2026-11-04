import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { getTheaterRun } from "@/lib/queries/theater";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored run shaped as theater steps. Polled every ~2s by /theater while the run is still running. Read-only. */
export async function GET(request: Request, ctx: { params: Promise<{ runId: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const { runId } = await ctx.params;
  if (!UUID.test(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const run = await getTheaterRun(db, companyId, runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api] theater run read failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
