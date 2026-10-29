import { NextResponse } from "next/server";
import { z } from "zod";
import { launchClaimFiling } from "@/lib/browser-agents/recovery";
import { agentErrorResponse, agentsDisabledResponse } from "@/lib/browser-agents/http";

const Params = z.object({ recoveryId: z.string().uuid() });

/** Files an already-approved claim (409 when no matching unconsumed approval exists). */
export async function POST(_request: Request, ctx: { params: Promise<{ recoveryId: string }> }): Promise<NextResponse> {
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
