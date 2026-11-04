import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { ReportServiceError, getReport } from "@/lib/reports/service";
import { approvalAcknowledgements, approveReportFromRunner, RunnerApprovalError } from "@/lib/close-out/approve-report";
import { approverNameSchema } from "@/lib/auth/approver";
import { approverLabel, authErrorResponse, requireSession, signInOf, type Session } from "@/lib/auth/session";
import { revalidateRunSurfaces } from "@/lib/ui/revalidate";

const Body = z.object({
  approvedBy: approverNameSchema,
  /** What the reviewer saw; a mismatch fails with 409 (M2). */
  expectedChecksum: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
  /** The UNVERIFIED rule-value count the person acknowledged ("approve anyway"); required when it is not zero. */
  acknowledgedUnverified: z.number().int().min(0).max(10_000).nullable().optional(),
  /** The never-sent due-diligence notice count the person acknowledged; required when it is not zero. */
  acknowledgedUnsent: z.number().int().min(0).max(10_000).nullable().optional(),
});

/**
 * Records the submit_report approval bound to the file checksum. Same server gate as the runner's approve-report:
 * unverified rule values or never-sent notices must be acknowledged by count ("approve anyway"), re-derived here.
 * Does NOT file anything.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await ctx.params);
    const body = Body.parse(await request.json().catch(() => ({})));
    const db = await getOutreachDb();
    const existing = await getReport(db, id);
    if (!existing) throw new ReportServiceError("not_found", `Report ${id} not found`);
    const { report, unverifiedAcknowledged, unsentAcknowledged } = await approveReportFromRunner(db, {
      companyId: existing.companyId,
      state: existing.state,
      reportId: id,
      approvedBy: approverLabel(session, body.approvedBy),
      expectedChecksum: body.expectedChecksum,
      acknowledgedUnverified: body.acknowledgedUnverified ?? null,
      acknowledgedUnsent: body.acknowledgedUnsent ?? null,
      signIn: signInOf(session),
    });
    revalidateRunSurfaces();
    return NextResponse.json(
      { reportId: report.id, status: report.status, approvalId: report.approvalId, unverifiedAcknowledged, unsentAcknowledged },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof RunnerApprovalError) {
      const { id } = await ctx.params;
      const existing = await getReport(await getOutreachDb(), id).catch(() => null);
      const required = existing ? await approvalAcknowledgements(await getOutreachDb(), existing.companyId, existing.state) : null;
      return NextResponse.json({ error: err.message, code: err.code, required }, { status: 409 });
    }
    return serviceErrorResponse(err);
  }
}
