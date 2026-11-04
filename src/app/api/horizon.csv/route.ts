import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { horizonCsv } from "@/lib/horizon/csv";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { getHorizon } from "@/lib/queries/horizon";

/** Hard ceiling so one request can never stream an unbounded table. */
const MAX_ROWS = 5000;

/**
 * Pre-stale reissue worklist (read-only): outstanding payments not yet stale, soonest first, with PROVISIONAL projected
 * dates. Reconciliation runs with persist:false; nothing is written and nothing is sent. Passcode-gated like other APIs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const horizon = await getHorizon(db, companyId);
    const truncated = horizon.items.length > MAX_ROWS;
    return new Response(horizonCsv(horizon.items.slice(0, MAX_ROWS)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="reissue-worklist-${horizon.asOf}.csv"`,
        "cache-control": "no-store",
        "x-horizon-truncated": truncated ? "true" : "false",
      },
    });
  } catch (err) {
    console.error("[api] horizon export failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
