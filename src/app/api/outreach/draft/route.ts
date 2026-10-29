import { NextResponse } from "next/server";
import { z } from "zod";
import { draftOutreach } from "@/lib/outreach/draft";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
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
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
