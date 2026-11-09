import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { AlreadyApprovedError, ApprovalRequiredError } from "@/lib/approvals";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { RuleApplyError, withdrawRuleApproval } from "@/lib/rules/apply";

/**
 * R4-02: withdraw the latest human rule approval for a state (a mistaken approval or a rehearsal).
 *
 * POST /api/rules/:state/withdraw
 *   body { version, withdrawnBy }
 *   200 { withdrawn, current, transitions }
 *   400 invalid body; 409 the version is not the state's latest approval.
 *
 * The approval row stays in rule_approvals with withdrawn_at/withdrawn_by (audit trail); the loader stops overlaying it,
 * so the rules return to the previous version. Recorded as a consumed apply_rule_change approval. rules/ is not written.
 */

const State = z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase());
const Body = z.object({
  version: z.string().min(1).max(200),
  withdrawnBy: z.string().trim().min(2, "Enter your name (2+ characters)").max(80),
});

export async function POST(request: Request, ctx: { params: Promise<{ state: string }> }): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  try {
    const state = State.parse((await ctx.params).state);
    const body = Body.parse(await request.json().catch(() => ({})));
    const db = await getOutreachDb();
    const res = await withdrawRuleApproval(db, { state, version: body.version, by: approverLabel(session, body.withdrawnBy) });
    const companyId = await resolveCompanyId(db, null);
    const recomputed = companyId ? await recomputeTimelines(db, companyId) : null;
    try {
      for (const p of ["/rules", "/dashboard", "/items", "/approvals"]) revalidatePath(p);
    } catch {
      // outside a Next request scope (unit tests)
    }
    return NextResponse.json({ ...res, transitions: recomputed?.transitions.length ?? 0 });
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
    if (err instanceof RuleApplyError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "stale" ? 409 : 400 });
    if (err instanceof AlreadyApprovedError) return NextResponse.json({ error: err.message, code: err.code, approvedBy: err.approvedBy }, { status: 409 });
    if (err instanceof ApprovalRequiredError) return NextResponse.json({ error: err.message, code: "approval_required" }, { status: 403 });
    console.error("[rules] withdraw failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
