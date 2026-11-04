"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { approverNameSchema } from "@/lib/auth/approver";
import { approverLabel, AuthError, requireSession } from "@/lib/auth/session";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { applyRuleApproval, RuleApplyError } from "@/lib/rules/apply";

const Input = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  /** One rule field path. */
  path: z.string().min(1).max(200).optional(),
  /** R4-20: the exact values the reviewer ticked one by one. There is no "approve everything" request. */
  paths: z.array(z.string().min(1).max(200)).min(1).max(200).optional(),
  by: approverNameSchema,
  /** The rule file version + sha256 the page rendered; the apply fails if the file changed since (M3). */
  expectedVersion: z.string().min(1).max(200),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).refine((v) => Boolean(v.path) !== Boolean(v.paths), "Choose the values to approve");

export type ApproveResult =
  | { ok: true; version: string; approved: number; transitions: number; message: string }
  | { ok: false; error: string };

/**
 * A human approving rule values is a legal-significance action: it records a NEW rule version (a DB approval overlaid on
 * the checked-in file, R4-02), then recomputes timelines. Every approved path is named by the reviewer (R4-20).
 */
export async function approveRulesAction(raw: z.input<typeof Input>): Promise<ApproveResult> {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { state, path, paths, by, expectedVersion, expectedSha256 } = parsed.data;
  try {
    const db = await getDb();
    const res = await applyRuleApproval(db, { state, ...(path ? { path } : { paths }), by: approverLabel(session, by), expectedVersion, expectedSha256 });
    const companyId = await resolveCompanyId(db, null);
    const result = companyId ? await recomputeTimelines(db, companyId) : null;
    for (const p of ["/rules", "/dashboard", "/items"]) revalidatePath(p);
    return {
      ok: true,
      version: res.version,
      approved: res.approved,
      transitions: result?.transitions.length ?? 0,
      message: `${res.approved} value${res.approved === 1 ? "" : "s"} verified by ${by}. Timelines recomputed.`,
    };
  } catch (e) {
    if (e instanceof RuleApplyError) return { ok: false, error: e.message };
    console.error("[rules] approval failed", e); // L10: details stay in the server log
    return { ok: false, error: "Could not save the approval. See the server log." };
  }
}
