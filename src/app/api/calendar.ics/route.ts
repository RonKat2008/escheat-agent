import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { companies } from "@/db/schema";
import { sessionGuard } from "@/lib/auth/session";
import { serviceErrorResponse } from "@/lib/b-http";
import { forecastToIcs } from "@/lib/forecast/calendar";
import { HORIZON_OPTIONS } from "@/lib/forecast/compute";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { getForecast } from "@/lib/queries";

const Query = z.object({
  state: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "state must be a two-letter code")
    .transform((s) => s.toUpperCase())
    .optional(),
  horizon: z.coerce
    .number()
    .int()
    .refine((n) => (HORIZON_OPTIONS as readonly number[]).includes(n), `horizon must be one of ${HORIZON_OPTIONS.join(", ")}`)
    .optional(),
});

/**
 * GET /api/calendar.ics: RFC 5545 feed of the company's report/remit due dates and due-diligence window openings
 * over the forecast horizon (default 18 months from the demo clock). Behind the passcode session like every API route.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const parsed = Query.safeParse({ state: url.searchParams.get("state") ?? undefined, horizon: url.searchParams.get("horizon") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  try {
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
    const forecast = await getForecast(db, companyId, {
      horizonMonths: parsed.data.horizon,
      states: parsed.data.state ? [parsed.data.state] : undefined,
    });
    const body = forecastToIcs(forecast, { companyId, companyName: company?.name ?? "Company", baseUrl: process.env.APP_BASE_URL?.trim() || undefined });
    const suffix = parsed.data.state ? `-${parsed.data.state.toLowerCase()}` : "";
    return new Response(body, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="escheat-deadlines${suffix}.ics"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
