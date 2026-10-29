"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ruleChanges } from "@/db/schema";
import { diffRules } from "@/lib/rules/diff";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { approveRuleField, approveRuleFile, loadRules, saveRuleVersion, syncRuleFileToDb } from "@/lib/rules/load";

const Input = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  /** One rule field path, or omitted to approve every field that has a value. */
  path: z.string().min(1).max(200).optional(),
  by: z.string().trim().min(2, "Enter your name (2+ characters)").max(80),
});

export type ApproveResult =
  | { ok: true; version: string; approved: number; transitions: number; message: string }
  | { ok: false; error: string };

/** A human approving a rule value is a legal-significance action: it writes a NEW rule version, then recomputes timelines. */
export async function approveRulesAction(raw: z.input<typeof Input>): Promise<ApproveResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { state, path, by } = parsed.data;
  try {
    const loaded = loadRules(state);
    const at = new Date().toISOString();
    const stamp = at.replace(/[-:]/g, "").replace(/\..*$/, "");
    const base = loaded.file.version.replace(/\+appr\..*$/, "");
    const next = path ? approveRuleField(loaded.file, path, by, at) : approveRuleFile(loaded.file, by, at);
    const approved = countVerified(next) - countVerified(loaded.file);
    if (approved === 0) return { ok: false, error: "Nothing to approve: those values are already verified, or have no value." };
    const versioned = { ...next, version: `${base}+appr.${stamp}` };
    saveRuleVersion(versioned);
    const db = await getDb();
    await syncRuleFileToDb(db, loadRules(state));
    await db.insert(ruleChanges).values({
      state,
      fromVersion: loaded.file.version,
      toVersion: versioned.version,
      diff: { changes: diffRules(loaded.file, versioned), approvedBy: by },
      sourceUrls: [],
      status: "applied",
      reviewedBy: by,
      reviewedAt: new Date(),
    });
    const companyId = await resolveCompanyId(db, null);
    const result = companyId ? await recomputeTimelines(db, companyId) : null;
    for (const p of ["/rules", "/dashboard", "/items"]) revalidatePath(p);
    return {
      ok: true,
      version: versioned.version,
      approved,
      transitions: result?.transitions.length ?? 0,
      message: `${approved} value${approved === 1 ? "" : "s"} verified by ${by}. Timelines recomputed.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the approval" };
  }
}

function countVerified(f: ReturnType<typeof loadRules>["file"]): number {
  return JSON.stringify(f).split('"verified":true').length - 1;
}
