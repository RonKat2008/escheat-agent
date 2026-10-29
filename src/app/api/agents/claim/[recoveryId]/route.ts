import { NextResponse } from "next/server";
import { z } from "zod";
import { launchClaimFiling } from "@/lib/browser-agents/recovery";
import { agentErrorResponse, agentsDisabledResponse } from "@/lib/browser-agents/http";
import { sessionGuard } from "@/lib/auth/session";

const Params = z.object({ recoveryId: z.string().uuid() });

/** Files an already-approved claim (409 when no matching unconsumed approval exists). */
export async function POST(request: Request, ctx: { params: Promise<{ recoveryId: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const disabled = agentsDisabledResponse();
  if (disabled) return disabled;
  try {
    const { recoveryId } = Params.parse(await ctx.params);
    const { runId } = await launchClaimFiling(recoveryId);
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
