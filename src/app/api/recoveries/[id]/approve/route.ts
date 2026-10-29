import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { approveClaim } from "@/lib/recoveries/service";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";

const Body = z.object({
  approvedBy: z.string().trim().min(1).max(200),
  /** What the reviewer saw; a mismatch fails with 409 (M2). */
  expectedPayloadSha256: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
});

/** Records the file_claim approval bound to the claim payload. Does NOT submit the claim. */
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
    const rec = await approveClaim(await getOutreachDb(), id, approverLabel(session, body.approvedBy), { expectedPayloadSha256: body.expectedPayloadSha256 });
    return NextResponse.json({ recoveryId: rec.id, status: rec.status, approvalId: rec.approvalId }, { status: 201 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
