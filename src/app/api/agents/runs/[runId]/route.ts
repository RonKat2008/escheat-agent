import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { agentErrorResponse } from "@/lib/browser-agents/http";

const Params = z.object({ runId: z.string().uuid() });

/** Run status + trace. `phase` is "awaiting_approval" while a filing run is paused at the portal's Approve button. */
export async function GET(_request: Request, ctx: { params: Promise<{ runId: string }> }): Promise<NextResponse> {
  try {
    const { runId } = Params.parse(await ctx.params);
    await migrate();
    const [run] = await (await getDb()).select().from(agentRuns).where(eq(agentRuns.id, runId));
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const output = (run.output ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      id: run.id,
      agent: run.agent,
      status: run.status,
      phase: output.phase ?? null,
      mode: (run.input as Record<string, unknown> | null)?.mode ?? output.mode ?? null,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      trace: run.trace ?? [],
      output,
    });
  } catch (err) {
    return agentErrorResponse(err);
  }
}
