import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApprovalRequiredError } from "@/lib/approvals";
import { approverLabel, authErrorResponse, requireSession, sessionGuard, type Session } from "@/lib/auth/session";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { adoptProposedValue, describeAdoption, RuleAdoptError, type RuleAdoptErrorCode } from "@/lib/rules/adopt";
import { RuleApplyError } from "@/lib/rules/apply";
import { RuleLoadError } from "@/lib/rules/load";

/**
 * R3-05: adopt a rule value from its official cited source.
 *
 * GET  /api/rules/:state/adopt?path=dueDiligence.requiredLanguage
 *   200 AdoptionPreview (src/lib/rules/adopt.ts): { state, path, expectedVersion, expectedSha256, proposal,
 *       before: { value, verified, status: { kind, text, source? } }, after: { value, verified, sources } | null,
 *       citations, impact: { blockedByRule, becomeDraftable, stillBlocked } | null }
 *
 * POST /api/rules/:state/adopt
 *   body { path, approvedBy, expectedVersion, expectedSha256, proposedText }
 *   201 { version, path, value, verifiedBy, verifiedAt, sources, approvalId, transitions }
 *   400 invalid body or approver missing; 404 unknown field / no rule file; 409 stale file, already set, text changed;
 *   422 nothing to adopt or the field does not take text.
 *
 * Writes a NEW rule version only after recording a human apply_rule_change approval bound to the file version, sha256
 * and the exact adopted text (same gate as the Rules page Approve).
 */

const State = z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase());
const RulePath = z.string().min(1).max(200);

const Body = z.object({
  path: RulePath,
  approvedBy: z.string().trim().min(2, "Enter your name (2+ characters)").max(80),
  expectedVersion: z.string().min(1).max(200),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
  proposedText: z.string().min(1).max(10_000),
});

const ADOPT_STATUS: Record<RuleAdoptErrorCode, number> = {
  approver_required: 400,
  unknown_field: 404,
  already_set: 409,
  text_mismatch: 409,
  no_proposal: 422,
  invalid_value: 422,
};

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  }
  if (err instanceof RuleAdoptError) return NextResponse.json({ error: err.message, code: err.code }, { status: ADOPT_STATUS[err.code] });
  if (err instanceof RuleApplyError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  if (err instanceof ApprovalRequiredError) return NextResponse.json({ error: err.message, code: "approval_required" }, { status: 403 });
  if (err instanceof RuleLoadError && /^(No rule file|Invalid state code)/.test(err.message)) {
    return NextResponse.json({ error: "No rule file for that state", code: "no_rules" }, { status: 404 });
  }
  console.error("[rules] adopt failed", err); // details stay in the server log
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

function revalidateRuleSurfaces(): void {
  try {
    for (const p of ["/rules", "/dashboard", "/items", "/approvals"]) revalidatePath(p);
  } catch {
    // outside a Next request scope (unit tests): nothing to revalidate
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ state: string }> }): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const state = State.parse((await ctx.params).state);
    const path = RulePath.parse(new URL(request.url).searchParams.get("path") ?? "");
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db, null);
    return NextResponse.json(await describeAdoption(db, { state, path, companyId }));
  } catch (err) {
    return errorResponse(err);
  }
}

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
    const res = await adoptProposedValue(db, {
      state,
      path: body.path,
      by: approverLabel(session, body.approvedBy),
      expectedVersion: body.expectedVersion,
      expectedSha256: body.expectedSha256,
      proposedText: body.proposedText,
    });
    const companyId = await resolveCompanyId(db, null);
    const recomputed = companyId ? await recomputeTimelines(db, companyId) : null;
    revalidateRuleSurfaces();
    return NextResponse.json({ ...res, transitions: recomputed?.transitions.length ?? 0 }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
