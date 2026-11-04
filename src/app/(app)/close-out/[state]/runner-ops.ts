/**
 * What each runner button does, client side. Every call goes through a server path that re-checks it: the chat card's
 * safe step action (drafts, generate+validate), the outreach compose/approve/send routes, the runner's report approval
 * (checksum bound, plus the "approve anyway" acknowledgement of unverified rules), the filing agent route and the
 * remittance route. Approvals carry the approver name the person typed and the hash they reviewed; the server re-checks
 * both (and the session) and refuses anything else. Nothing here approves on its own.
 */
import { runClosePlanStep } from "@/app/(app)/chat/actions";
import { postJson } from "@/components/b/api";
import type { RunnerControl } from "@/lib/close-out/runner-model";

export type OpResult = { ok: true; message: string; runId?: string } | { ok: false; error: string };

export interface OpInput {
  approver: string;
  /** approve_report: the person ticked "approve anyway" for the unverified rule values shown. */
  acknowledged?: boolean;
  /** record_remittance: what the person typed. */
  remit?: { date: string; reference: string };
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

interface SendResponse {
  sent: boolean;
  offline: boolean;
}

/** R5-03: the message follows each letter's real outcome (offline record vs Lob test), never a hard-coded mode. */
export function sendMessage(results: readonly SendResponse[]): string {
  const offline = results.filter((r) => r.offline).length;
  const lob = results.filter((r) => !r.offline && r.sent).length;
  const parts: string[] = [];
  if (offline) parts.push(`${plural(offline, "letter")} recorded as sent in offline mode; nothing was mailed`);
  if (lob) parts.push(`${plural(lob, "letter")} sent through Lob test mode; nothing is mailed`);
  const other = results.length - offline - lob;
  if (other) parts.push(`${plural(other, "letter")} not accepted by the provider`);
  return `${parts.join(". ")}.`;
}

async function sendLetters(ids: string[], requestedBy: string): Promise<OpResult> {
  const results: SendResponse[] = [];
  for (const id of ids) {
    const r = await postJson<SendResponse>(`/api/outreach/${id}/send`, { requestedBy });
    if (!r.ok) {
      return { ok: false, error: results.length ? `${sendMessage(results)} Then stopped: ${r.error}` : r.error };
    }
    results.push(r.data);
  }
  return { ok: true, message: sendMessage(results) };
}

/**
 * Builds the report's evidence pack right after the approval, while its items are still To Report. The pack is built
 * from the To Report pool (reports/service.ts), so once filing moves the items to "reported" it can no longer be
 * built; freezing it here keeps the receipt's evidence link working. Read-only for the filing itself.
 */
async function freezeEvidencePack(reportId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/reports/${reportId}/evidence`, { cache: "no-store" });
    await res.arrayBuffer();
    return res.ok;
  } catch {
    return false;
  }
}

export async function runOp(state: string, control: RunnerControl, input: OpInput): Promise<OpResult> {
  const name = input.approver.trim();
  switch (control.op) {
    case "draft_letters": {
      const r = await runClosePlanStep(state, "letters_draft");
      return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
    }
    case "generate_report": {
      const r = await runClosePlanStep(state, "report_generate");
      return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
    }
    case "compose_letters": {
      const r = await postJson<{ summary: { composed: number; ready: number; blocked: number; failed: number } }>("/api/outreach/compose-all", {
        channel: "letter",
        outreachIds: control.outreachIds,
      });
      if (!r.ok) return { ok: false, error: r.error };
      const s = r.data.summary;
      return { ok: true, message: `Composed ${plural(s.composed, "letter")}: ${s.ready} ready to read and approve${s.blocked ? `, ${s.blocked} need fixing` : ""}. Nothing was sent.` };
    }
    case "approve_letters": {
      if (!name) return { ok: false, error: "Type your name to approve." };
      const r = await postJson<{ summary: { approved: number; failed: number }; results: { ok: boolean; blockedReason?: string }[] }>("/api/outreach/bulk-approve", {
        channel: "letter",
        approvedBy: name,
        items: control.items,
      });
      if (!r.ok) return { ok: false, error: r.error };
      const { approved, failed } = r.data.summary;
      if (approved === 0) return { ok: false, error: r.data.results.find((x) => !x.ok)?.blockedReason ?? "No letter was approved." };
      const who = control.letters.map((l) => l.payeeName).join(", ");
      return { ok: true, message: `${name} approved ${plural(approved, "letter")} (${who})${failed ? `; ${failed} blocked` : ""}. Nothing was sent.` };
    }
    case "send_letters":
      if (!name) return { ok: false, error: "Type your name before sending." };
      return sendLetters(control.outreachIds, name);
    case "approve_report": {
      if (!name) return { ok: false, error: "Type your name to approve." };
      if (control.unverifiedCount > 0 && !input.acknowledged) return { ok: false, error: 'Tick "approve anyway" to acknowledge the unverified rule values first.' };
      const r = await postJson("/api/close-out/runner/approve-report", {
        state,
        reportId: control.reportId,
        approvedBy: name,
        expectedChecksum: control.expectedChecksum,
        acknowledgedUnverified: input.acknowledged ? control.unverifiedCount : null,
      });
      if (!r.ok) return { ok: false, error: r.error };
      const pack = await freezeEvidencePack(control.reportId);
      return { ok: true, message: `${name} approved this exact file. Nothing is filed until you run the agent.${pack ? "" : " The evidence pack could not be built yet; download it from Reports."}` };
    }
    case "run_filing": {
      const r = await postJson<{ runId: string }>("/api/agents/file", { reportId: control.reportId, state });
      return r.ok ? { ok: true, message: "Filing agent started on the replica portal.", runId: r.data.runId } : { ok: false, error: r.error };
    }
    case "record_remittance": {
      if (!name) return { ok: false, error: "Type your name to record the remittance." };
      const r = await postJson<{ itemCount: number }>("/api/close-out/remit", {
        state,
        reportId: control.reportId,
        approvedBy: name,
        remittedOn: input.remit?.date ?? control.defaultDate,
        reference: input.remit?.reference.trim() || null,
        expectedCount: control.expectedCount,
        expectedCents: control.expectedCents,
      });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, message: `${name} recorded the remittance. ${plural(r.data.itemCount, "item")} moved to Remitted; the late clock stopped. Nothing was paid from this app.` };
    }
  }
}
