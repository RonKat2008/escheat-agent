import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { reports } from "@/db/schema";
import { launchFilingAgent } from "@/lib/browser-agents/filing";
import { agentErrorResponse, agentsDisabledResponse, readJson } from "@/lib/browser-agents/http";

const Body = z.object({ reportId: z.string().uuid(), state: z.enum(["CA", "DE", "TX"]).optional() });

/** Starts the filing agent in the background and returns its run id (202). */
export async function POST(request: Request): Promise<NextResponse> {
  const disabled = agentsDisabledResponse();
  if (disabled) return disabled;
  try {
    const body = Body.parse(await readJson(request));
    await migrate();
    const [report] = await (await getDb()).select({ state: reports.state }).from(reports).where(eq(reports.id, body.reportId));
    const state = body.state ?? report?.state;
    if (!state) return NextResponse.json({ error: `Report ${body.reportId} not found.` }, { status: 404 });
    const { runId } = await launchFilingAgent({ reportId: body.reportId, state });
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
