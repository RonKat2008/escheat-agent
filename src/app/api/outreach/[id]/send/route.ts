import { NextResponse } from "next/server";
import { z } from "zod";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { sendOutreach } from "@/lib/outreach/send";
import { sessionGuard } from "@/lib/auth/session";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ to: z.string().trim().min(1).max(320).optional(), requestedBy: z.string().trim().max(200).optional() });

/** Runs the channel executor, which asserts a matching unconsumed approval before touching any API. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  let json: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }
  }
  try {
    const { id } = Params.parse(await ctx.params);
    const body = Body.parse(json);
    const result = await sendOutreach(await getOutreachDb(), id, body);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
