import { NextResponse } from "next/server";
import { z } from "zod";
import { draftOutreach } from "@/lib/outreach/draft";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { OutreachStateError } from "@/lib/outreach/errors";
import { sessionGuard } from "@/lib/auth/session";

const Body = z.object({
  staleItemId: z.string().uuid(),
  channel: z.enum(["letter", "email", "voice"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  try {
    const body = Body.parse(json);
    const result = await draftOutreach(await getOutreachDb(), body.staleItemId, body.channel);
    return NextResponse.json({ drafted: true, ...result }, { status: 201 });
  } catch (err) {
    // R4-25: a refusal (e.g. the due-diligence window closed) is an answer, not a failure: 200 with a typed result,
    // so the browser never logs a red 409 for a correct "no".
    if (err instanceof OutreachStateError && err.reason === "draft_refused") {
      return NextResponse.json({ drafted: false, code: "draft_refused", reason: err.message });
    }
    return errorResponse(err);
  }
}
