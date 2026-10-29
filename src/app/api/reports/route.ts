import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { generateStateReport } from "@/lib/reports/service";

const Body = z.object({ state: z.string().length(2) });

/** Generate + validate the NAUPA report for a state's To Report items. Files nothing. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = Body.parse(await request.json().catch(() => ({})));
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const result = await generateStateReport(db, companyId, body.state);
    return NextResponse.json(
      {
        reportId: result.report.id,
        status: result.report.status,
        itemCount: result.report.itemCount,
        totalCents: result.report.totalCents,
        errors: result.errors,
        warnings: result.warnings,
      },
      { status: 201 },
    );
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
