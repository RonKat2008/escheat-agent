import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { approveReport } from "@/lib/reports/service";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";

const Body = z.object({
  approvedBy: z.string().trim().min(1).max(200),
  /** What the reviewer saw; a mismatch fails with 409 (M2). */
  expectedChecksum: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
});

/** Records the submit_report approval bound to the file checksum. Does NOT file anything. */
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
    const report = await approveReport(await getOutreachDb(), id, approverLabel(session, body.approvedBy), { expectedChecksum: body.expectedChecksum });
    return NextResponse.json({ reportId: report.id, status: report.status, approvalId: report.approvalId }, { status: 201 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
