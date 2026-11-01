/**
 * The only steps a close-out card may run itself, re-derived on the server from fresh records (the client sends a
 * state and a step id, never item ids). Both are reversible and need no approval: letter DRAFTS through the bulk
 * draft path, and a validated report FILE through the existing generate_report chat tool (which refuses to replace a
 * report a person already holds). Approving, sending, submitting and paying are not here and cannot be requested.
 */
import type { Db } from "@/db/client";
import type { ClosePlan, CloseStepId } from "@/lib/chat/ui-types";
import { executeChatTool } from "@/lib/chat/tools";
import { BULK_MAX, bulkDraftOutreach } from "@/lib/outreach/bulk";
import { deriveClosePlan } from "./derive";
import { loadCloseSnapshot } from "./plan";

export type CloseStepResult = { ok: true; message: string; plan: ClosePlan } | { ok: false; error: string; plan: ClosePlan | null };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export async function runCloseStep(db: Db, companyId: string, state: string, stepId: CloseStepId): Promise<CloseStepResult> {
  const snap = await loadCloseSnapshot(db, companyId, state);
  const before = deriveClosePlan(snap);
  const step = before.steps.find((s) => s.id === stepId);
  if (!step?.action) {
    return { ok: false, error: "That step is not something chat can do. It needs your action at its gate in the app.", plan: before };
  }
  const refreshed = async () => deriveClosePlan(await loadCloseSnapshot(db, companyId, state));

  if (step.action.kind === "draft_letters") {
    const ids = snap.items.filter((i) => i.status === "dd_pending" && i.draftable).map((i) => i.id).slice(0, BULK_MAX);
    const results = await bulkDraftOutreach(db, { companyId, channel: "letter", staleItemIds: ids });
    const drafted = results.filter((r) => r.status === "drafted").length;
    const failed = results.filter((r) => r.status === "failed");
    const plan = await refreshed();
    if (drafted === 0 && failed.length > 0) return { ok: false, error: `No letters were drafted: ${failed[0]!.reason}`, plan };
    return {
      ok: true,
      message: `Drafted ${plural(drafted, "letter")}${failed.length ? ` (${failed.length} failed)` : ""}. They wait for your approval in Approvals; nothing was sent.`,
      plan,
    };
  }

  const r = await executeChatTool("generate_report", { state: before.state }, { db, companyId });
  const plan = await refreshed();
  if (!r.ok) return { ok: false, error: r.error, plan };
  const held = r.data as { regenerated?: boolean; reason?: string };
  if (held.regenerated === false) return { ok: false, error: held.reason ?? "A person holds this report, so nothing was regenerated.", plan };
  return { ok: true, message: `${r.summary}. Generated and validated only; nothing was filed.`, plan };
}
