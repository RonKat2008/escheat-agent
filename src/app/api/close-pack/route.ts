import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { buildClosePack } from "@/lib/close-pack/build";
import { isMonthId } from "@/lib/close-pack/period";
import { resolveCompanyId } from "@/lib/pipeline/company";

/**
 * GET /api/close-pack?period=YYYY-MM: the month-end close pack as a ZIP (journal CSV, roll-forward PDF, audit binder,
 * Activity CSV, tie-out PDF, manifest.json). The period defaults to the demo clock's month. Read-only: a file only,
 * nothing is posted or sent. Passcode-gated like the other APIs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("period");
  if (raw !== null && !isMonthId(raw)) {
    return NextResponse.json({ error: "period must be YYYY-MM", code: "bad_period" }, { status: 400 });
  }
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const result = await buildClosePack(db, companyId, raw);
    if (!result.ok) return NextResponse.json({ error: result.error, code: "bad_period" }, { status: result.status });
    const { pack } = result;
    return new Response(Buffer.from(pack.zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="escheat-close-pack-${pack.manifest.period}.zip"`,
        "cache-control": "no-store",
        "x-close-pack-files": String(pack.files.length),
        "x-close-pack-ties": pack.manifest.tieOut.allTie ? "true" : "false",
      },
    });
  } catch (err) {
    console.error("[api] close pack failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
