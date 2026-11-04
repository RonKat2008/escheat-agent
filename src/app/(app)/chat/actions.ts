"use server";

import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { AuthError, requireSession } from "@/lib/auth/session";
import type { ClosePlan } from "@/lib/chat/ui-types";
import { runCloseStep, type CloseStepResult } from "@/lib/close-out/actions";
import { buildChatClosePlan } from "@/lib/chat/close-plan-runner";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { explainItem, findStaleItemId, getDefaultCompanyId, type Explanation } from "@/lib/queries";
import { revalidateRunSurfaces } from "@/lib/ui/revalidate";

export type ItemTimelineResult = { ok: true; explanation: Explanation } | { ok: false; error: string };

const ItemId = z.string().uuid();

/**
 * Read-only: the legal timeline for one item, for the chat's inline row expansion. Same session gate and company
 * scope as the items page; it never calls the model and never writes.
 */
export async function loadItemTimeline(itemId: string): Promise<ItemTimelineResult> {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  const parsed = ItemId.safeParse(itemId);
  if (!parsed.success) return { ok: false, error: "Unknown item." };
  try {
    const db = await getDb();
    const companyId = await getDefaultCompanyId(db);
    const id = await findStaleItemId(db, companyId, parsed.data);
    const explanation = id ? await explainItem(db, id) : null;
    return explanation ? { ok: true, explanation } : { ok: false, error: "This item no longer exists." };
  } catch (e) {
    console.error("[chat] item timeline failed", e);
    return { ok: false, error: "Could not load the timeline. Open it in Items instead." };
  }
}

const CloseInput = z.object({
  state: z.enum(["CA", "DE", "TX"]),
  stepId: z.enum(["letters_draft", "letters_approve", "letters_send", "rules_verify", "report_generate", "report_approve", "report_submit", "remit"]),
});

export type ClosePlanResult = { ok: true; plan: ClosePlan } | { ok: false; error: string };

async function closeContext(): Promise<{ db: Db; companyId: string } | { error: string }> {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message };
    throw e;
  }
  try {
    const db = await getOutreachDb();
    const companyId = await resolveCompanyId(db);
    return companyId ? { db, companyId } : { error: "No company is loaded yet. Reload the demo data and try again." };
  } catch (e) {
    console.error("[chat] close-out database unavailable", e);
    return { error: "The database is unavailable. Try again in a moment." };
  }
}

/** Read-only: the same close-out plan the chat tool builds, re-read from the records (the card's Refresh). */
export async function refreshClosePlan(state: string): Promise<ClosePlanResult> {
  const parsed = CloseInput.shape.state.safeParse(state);
  if (!parsed.success) return { ok: false, error: "Close-out plans cover CA, DE and TX only." };
  const c = await closeContext();
  if ("error" in c) return { ok: false, error: c.error };
  try {
    return { ok: true, plan: await buildChatClosePlan(c.db, c.companyId, parsed.data) };
  } catch (e) {
    console.error("[chat] close-out refresh failed", e);
    return { ok: false, error: "Could not refresh the plan. Ask again in chat." };
  }
}

/**
 * Runs one SAFE close-out step (letter drafts, or a validated report file). The server re-derives the plan and refuses
 * any step that is not marked runnable, so approving, sending, submitting and paying can never be requested from here.
 */
export async function runClosePlanStep(state: string, stepId: string): Promise<CloseStepResult> {
  const parsed = CloseInput.safeParse({ state, stepId });
  if (!parsed.success) return { ok: false, error: "Unknown close-out step.", plan: null };
  const c = await closeContext();
  if ("error" in c) return { ok: false, error: c.error, plan: null };
  try {
    const r = await runCloseStep(c.db, c.companyId, parsed.data.state, parsed.data.stepId);
    revalidateRunSurfaces();
    // The card counts like the runner (R6-04): re-read the plan with the runner's counts after the step.
    return r.plan ? { ...r, plan: await buildChatClosePlan(c.db, c.companyId, parsed.data.state) } : r;
  } catch (e) {
    console.error("[chat] close-out step failed", e);
    return { ok: false, error: "That step failed unexpectedly. Details are in the server log.", plan: null };
  }
}
