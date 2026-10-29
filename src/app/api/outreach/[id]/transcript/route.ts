import { NextResponse } from "next/server";
import { z } from "zod";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { fetchCallTranscript } from "@/lib/outreach/voice";
import { sessionGuard } from "@/lib/auth/session";

const Params = z.object({ id: z.string().uuid() });

/** Pull the (simulated) call transcript from ElevenLabs and store it on the outreach row. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const { id } = Params.parse(await ctx.params);
    return NextResponse.json(await fetchCallTranscript(await getOutreachDb(), id));
  } catch (err) {
    return errorResponse(err);
  }
}
