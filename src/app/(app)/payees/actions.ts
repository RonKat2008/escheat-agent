"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approverLabel, AuthError, requireSession } from "@/lib/auth/session";
import { applyPayeeChange, previewPayeeChange } from "@/lib/payees/review";
import { applyInputSchema, PayeeChangeError, previewInputSchema, type ChangePreview } from "@/lib/payees/review-types";
import { getCtx } from "@/lib/ui/ctx";

export type PreviewResult = { ok: true; preview: ChangePreview } | { ok: false; error: string };
export type ApplyResult = { ok: true; preview: ChangePreview; applied: boolean; payeeId: string | null } | { ok: false; error: string };

async function guard(): Promise<{ error: string } | { session: Awaited<ReturnType<typeof requireSession>> }> {
  try {
    return { session: await requireSession() };
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
}

function describe(e: unknown): string {
  if (e instanceof PayeeChangeError) return e.message;
  console.error("[payees] change failed", e);
  return "Could not complete the change. See the server log.";
}

/** Read-only: before/after diff of every item the change would touch. Writes nothing. */
export async function previewPayeeChangeAction(raw: z.input<typeof previewInputSchema>): Promise<PreviewResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const parsed = previewInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  try {
    const { db, companyId } = await getCtx();
    return { ok: true, preview: await previewPayeeChange(db, companyId, parsed.data.change) };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/** Authenticated, human-confirmed change. The recorded actor is the typed name plus the session label. */
export async function applyPayeeChangeAction(raw: z.input<typeof applyInputSchema>): Promise<ApplyResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const parsed = applyInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  try {
    const { db, companyId } = await getCtx();
    const res = await applyPayeeChange(db, companyId, { ...parsed.data, by: approverLabel(g.session, parsed.data.by) });
    for (const p of ["/payees", "/items", "/dashboard", "/approvals", "/reports"]) revalidatePath(p);
    return { ok: true, preview: res.preview, applied: res.applied, payeeId: res.payeeId };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}
