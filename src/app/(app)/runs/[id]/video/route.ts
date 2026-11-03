import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { ARTIFACTS_ROOT } from "@/lib/browser-agents/recorder";
import { getAgentRun } from "@/lib/queries";
import { runVideo } from "../trace-view";

const Params = z.object({ id: z.string().uuid() });

const notFound = () => NextResponse.json({ error: "Video not found" }, { status: 404 });

/**
 * Serves the screen recording a browser-agent run stored in its output. Only the path the run itself recorded is
 * served, and only from inside that run's artifact folder (no arbitrary file reads), same as the screenshot route.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return notFound();
  const { id } = parsed.data;

  const run = await getAgentRun(await getDb(), id);
  const rel = runVideo(run?.output);
  if (!rel) return notFound();

  try {
    const runDir = await realpath(path.resolve(ARTIFACTS_ROOT, id));
    const file = await realpath(path.resolve(rel));
    if (!file.startsWith(runDir + path.sep) || !file.toLowerCase().endsWith(".webm")) return notFound();
    const body = await readFile(file);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": "video/webm",
        "content-length": String(body.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
