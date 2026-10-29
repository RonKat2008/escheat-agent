"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { approverLabel, AuthError, requireSession } from "@/lib/auth/session";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { applyRuleApproval, RuleApplyError } from "@/lib/rules/apply";

const Input = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  /** One rule field path, or omitted to approve every field that has a value. */
  path: z.string().min(1).max(200).optional(),
  by: z.string().trim().min(2, "Enter your name (2+ characters)").max(80),
  /** The rule file version + sha256 the page rendered; the apply fails if the file changed since (M3). */
  expectedVersion: z.string().min(1).max(200),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ApproveResult =
  | { ok: true; version: string; approved: number; transitions: number; message: string }
  | { ok: false; error: string };

/** A human approving a rule value is a legal-significance action: it writes a NEW rule version, then recomputes timelines. */
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
  const { state, path, by, expectedVersion, expectedSha256 } = parsed.data;
  try {
    const db = await getDb();
    const res = await applyRuleApproval(db, { state, path, by: approverLabel(session, by), expectedVersion, expectedSha256 });
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
