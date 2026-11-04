import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { serviceErrorResponse } from "@/lib/b-http";
import { loadCfoBrief } from "@/lib/cfo-brief/data";
import { buildCfoBrief } from "@/lib/cfo-brief/pdf";
import { resolveCompanyId } from "@/lib/pipeline/company";

/**
 * GET /api/cfo-brief.pdf: the one-page CFO brief from live data (the same queries as the dashboard, ledger, forecast,
 * approvals and recoveries). Read-only: nothing is written or sent. Behind the passcode session like every API route.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const data = await loadCfoBrief(db, companyId, { generatedAt: new Date() });
    const bytes = await buildCfoBrief(data);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="cfo-brief-${data.asOf}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
