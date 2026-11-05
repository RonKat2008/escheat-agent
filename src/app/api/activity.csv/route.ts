import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { exportActivity } from "@/lib/activity-export";
import { sessionGuard } from "@/lib/auth/session";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { parseActivityParams } from "@/lib/queries/activity";

/** Export of the filtered activity log. Same filters as /activity (the cursor is ignored). Passcode-gated like other APIs. */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { cursor: _ignored, ...filters } = parseActivityParams(params);
    void _ignored;
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    // Activity is a demo-calendar view: filters and the demo_day column use the demo day each event happened on.
    const out = await exportActivity(db, companyId, filters);
    return new Response(out.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="activity.csv"',
        "cache-control": "no-store",
        "x-activity-truncated": out.truncated ? "true" : "false",
        "x-audit-chain-head": out.chain.headHash,
        "x-audit-chain-verified": out.chain.ok ? "true" : "false",
        "x-audit-chain-length": String(out.chain.length),
      },
    });
  } catch (err) {
    console.error("[api] activity export failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
