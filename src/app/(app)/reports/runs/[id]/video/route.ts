import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { ARTIFACTS_ROOT } from "@/lib/browser-agents/recorder";
import { getAgentRun } from "@/lib/queries";

const Params = z.object({ id: z.string().uuid() });

const notFound = () => NextResponse.json({ error: "Video not found" }, { status: 404 });

/**
 * Serves the session video a filing run recorded (agent_runs.output.video), shown inline in the report's File step.
 * Only the path the run itself stored is served, and only from inside that run's artifact folder (symlinks resolved
 * on both sides first), mirroring /runs/[id]/shots/[step].
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return notFound();
  const { id } = parsed.data;

  const run = await getAgentRun(await getDb(), id);
  const output = run?.output;
  const rel = output && typeof output === "object" && "video" in output ? (output as { video?: unknown }).video : undefined;
  if (typeof rel !== "string" || !rel.toLowerCase().endsWith(".webm")) return notFound();

  try {
    const runDir = await realpath(path.resolve(ARTIFACTS_ROOT, id));
    const file = await realpath(path.resolve(rel));
    if (!file.startsWith(runDir + path.sep) || !file.toLowerCase().endsWith(".webm")) return notFound();
    const body = await readFile(file);
    return new NextResponse(new Uint8Array(body), {
      headers: { "content-type": "video/webm", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return notFound();
  }
}
