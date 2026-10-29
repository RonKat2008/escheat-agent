import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { launchRecoveryAgent } from "@/lib/browser-agents/recovery";
import { agentErrorResponse, agentsDisabledResponse, readJson } from "@/lib/browser-agents/http";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { sessionGuard } from "@/lib/auth/session";

const Body = z.object({
  companyId: z.string().uuid().optional(),
  states: z.array(z.enum(["CA", "DE", "TX"])).min(1).optional(),
});

/** Starts the recovery (reverse-search) agent in the background and returns its run id (202). */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const disabled = agentsDisabledResponse();
  if (disabled) return disabled;
  try {
    const body = Body.parse(await readJson(request));
    await migrate();
    const companyId = await resolveCompanyId(await getDb(), body.companyId);
    if (!companyId) return NextResponse.json({ error: "No company found. Seed the demo data first." }, { status: 404 });
    const { runId } = await launchRecoveryAgent({ companyId, states: body.states });
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
