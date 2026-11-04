import { NextResponse } from "next/server";
import { z } from "zod";
import { approverNameSchema } from "@/lib/auth/approver";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { serviceErrorResponse } from "@/lib/b-http";
import { ClosePlanError } from "@/lib/close-out/plan";
import { recordRemittance, REFERENCE_MAX, RemittanceError } from "@/lib/close-out/remittance";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { revalidateRunSurfaces } from "@/lib/ui/revalidate";

const Body = z.object({
  state: z.string().trim().min(2).max(2),
  reportId: z.string().uuid(),
  approvedBy: approverNameSchema,
  remittedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  reference: z.string().max(REFERENCE_MAX * 2).nullable().optional(),
  expectedCount: z.number().int().min(1),
  expectedCents: z.number().int().min(0),
});

/**
 * POST /api/close-out/remit (R5-05): record that the state was paid OUTSIDE this app. A person must type their name;
 * the approval is bound to exactly the reported items, total, date and reference they saw, and is consumed once to
 * move the items to Remitted. Nothing is paid from here. Synthetic demo data only.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  try {
    const body = Body.parse(await request.json().catch(() => ({})));
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const res = await recordRemittance(db, { ...body, companyId, approvedBy: approverLabel(session, body.approvedBy) });
    revalidateRunSurfaces();
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    if (err instanceof RemittanceError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    if (err instanceof ClosePlanError) return NextResponse.json({ error: err.message, code: "invalid_state" }, { status: 400 });
    return serviceErrorResponse(err);
  }
}
