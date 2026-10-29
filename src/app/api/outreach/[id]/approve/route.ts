import { NextResponse } from "next/server";
import { z } from "zod";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { approveOutreach } from "@/lib/outreach/send";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({
  approvedBy: z.string().trim().min(1).max(200),
  /** outreachContentSha256 of the draft the reviewer saw (from the queue). Approving changed content fails with 409 (M2). */
  expectedContentSha256: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
  /** Email address or phone number; required for email/voice outreach. */
  to: z.string().trim().min(1).max(320).optional(),
});

/** Records the in-app approval for the exact current payload. Does NOT send anything. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  try {
    const { id } = Params.parse(await ctx.params);
    const body = Body.parse(json);
    const result = await approveOutreach(await getOutreachDb(), id, approverLabel(session, body.approvedBy), {
      to: body.to,
      expectedContentSha256: body.expectedContentSha256,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
