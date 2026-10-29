import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApprovalRequiredError } from "@/lib/approvals";
import { NonReplicaUrlError } from "@/lib/replica/guard";
import { ClaimPreconditionError } from "./recovery";
import { FilingPreconditionError } from "./filing";
import { AgentAlreadyRunningError } from "./runs";

/**
 * Browser agents need a real Chromium and a long-lived process, so they cannot run on Vercel.
 * In production (or on Vercel) the routes refuse unless AGENTS_ENABLED=1.
 */
export function agentsDisabledResponse(): NextResponse | null {
  const prod = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  if (prod && process.env.AGENTS_ENABLED !== "1") {
    return NextResponse.json(
      { error: "Browser agents are disabled in this deployment (set AGENTS_ENABLED=1 on a host that can run Chromium)." },
      { status: 503 },
    );
  }
  return null;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function agentErrorResponse(err: unknown): NextResponse {
  if (err instanceof SyntaxError) return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  if (err instanceof ZodError) return NextResponse.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
  if (err instanceof AgentAlreadyRunningError) return NextResponse.json({ error: err.message, runId: err.runId }, { status: 409 });
  if (err instanceof ApprovalRequiredError) return NextResponse.json({ error: err.message }, { status: 409 });
  if (err instanceof FilingPreconditionError || err instanceof ClaimPreconditionError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  if (err instanceof NonReplicaUrlError) return NextResponse.json({ error: err.message }, { status: 403 });
  console.error("[agents] unexpected error:", err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
}
