import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { ARTIFACTS_ROOT } from "@/lib/browser-agents/recorder";
import { getAgentRun } from "@/lib/queries";

const Params = z.object({ id: z.string().uuid(), step: z.coerce.number().int().min(0).max(10_000) });

const notFound = () => NextResponse.json({ error: "Screenshot not found" }, { status: 404 });

/**
 * Serves the screenshot a run recorded on one trace step. Only a path the run itself stored is served,
 * and only from inside that run's artifact folder (no arbitrary file reads).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; step: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return notFound();
  const { id, step } = parsed.data;

  const run = await getAgentRun(await getDb(), id);
  const entry = Array.isArray(run?.trace) ? run.trace[step] : undefined;
  const rel = entry && typeof entry === "object" && "screenshot" in entry ? (entry as { screenshot?: unknown }).screenshot : undefined;
  if (typeof rel !== "string" || !rel.toLowerCase().endsWith(".png")) return notFound();

  try {
    // Resolve symlinks on BOTH sides before the containment check, so a link inside the run folder cannot escape it.
    const runDir = await realpath(path.resolve(ARTIFACTS_ROOT, id));
    const file = await realpath(path.resolve(rel));
    if (!file.startsWith(runDir + path.sep) || !file.toLowerCase().endsWith(".png")) return notFound();
    const body = await readFile(file);
    return new NextResponse(new Uint8Array(body), {
      headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return notFound();
  }
}
