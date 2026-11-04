import { NextResponse } from "next/server";
import { z } from "zod";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { serviceErrorResponse } from "@/lib/b-http";
import { approveReportFromRunner, RunnerApprovalError } from "@/lib/close-out/approve-report";
import { ClosePlanError } from "@/lib/close-out/plan";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { revalidateRunSurfaces } from "@/lib/ui/revalidate";

const Body = z.object({
  state: z.string().trim().min(2).max(2),
  reportId: z.string().uuid(),
  approvedBy: z.string().trim().min(1).max(200),
  expectedChecksum: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
  /** R5-04: the UNVERIFIED rule-value count the person acknowledged ("approve anyway"); required when it is not zero. */
  acknowledgedUnverified: z.number().int().min(0).max(10_000).nullable().optional(),
});

/**
 * POST /api/close-out/runner/approve-report: the runner's report approval. Records the submit_report approval bound
 * to the file checksum, under the session and the typed name, ONLY when any unverified rule values were acknowledged.
 * Does NOT file anything.
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
    const { report, unverifiedAcknowledged } = await approveReportFromRunner(db, {
      companyId,
      state: body.state,
      reportId: body.reportId,
      approvedBy: approverLabel(session, body.approvedBy),
      expectedChecksum: body.expectedChecksum,
      acknowledgedUnverified: body.acknowledgedUnverified ?? null,
    });
    revalidateRunSurfaces();
    return NextResponse.json({ reportId: report.id, status: report.status, approvalId: report.approvalId, unverifiedAcknowledged }, { status: 201 });
  } catch (err) {
    if (err instanceof RunnerApprovalError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    if (err instanceof ClosePlanError) return NextResponse.json({ error: err.message, code: "invalid_state" }, { status: 400 });
    return serviceErrorResponse(err);
  }
}
