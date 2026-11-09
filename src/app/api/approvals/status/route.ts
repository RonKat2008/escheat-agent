import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionGuard } from "@/lib/auth/session";
import { cardApprovalStatus } from "@/lib/ask/cards/approval-status";
import { getOutreachDb } from "@/lib/outreach/db";

const Query = z.object({ kind: z.enum(["outreach", "report", "claim"]), id: z.string().uuid() });

/**
 * GET /api/approvals/status?kind=outreach|report|claim&id=<uuid>: whether that row is approved, and by whom (R11-02).
 * Read-only; an Ask card calls it on mount so a restored transcript never offers a second approval.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const q = Query.safeParse({ kind: url.searchParams.get("kind"), id: url.searchParams.get("id") });
  if (!q.success) {
    return NextResponse.json({ error: "Invalid request", issues: q.error.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  }
  try {
    const status = await cardApprovalStatus(await getOutreachDb(), q.data.kind, q.data.id);
    if (!status) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[approvals] status failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
