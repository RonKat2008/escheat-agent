import { NextResponse } from "next/server";
import { z } from "zod";
import { approverNameSchema } from "@/lib/auth/approver";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { rejectOutreach } from "@/lib/outreach/reject";
import { REJECT_REASON_MAX_CHARS, REJECT_REASON_MIN_CHARS } from "@/lib/outreach/reject-limits";
import { revalidateRunSurfaces } from "@/lib/ui/revalidate";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({
  rejectedBy: approverNameSchema,
  reason: z.string().trim().min(REJECT_REASON_MIN_CHARS, "Say why you are discarding this draft").max(REJECT_REASON_MAX_CHARS),
});

/** Discards a draft (draft / awaiting approval / blocked). Sends nothing; refuses anything already approved or sent. */
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
    const result = await rejectOutreach(await getOutreachDb(), id, approverLabel(session, body.rejectedBy), body.reason);
    revalidateRunSurfaces();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
