/**
 * What each runner button does, client side. Every call goes through an EXISTING server path: the chat card's safe
 * step action (drafts, generate+validate), the outreach compose/approve/send routes, the report approve route and the
 * filing agent route. Approvals carry the approver name the person typed and the hash they reviewed; the server
 * re-checks both (and the session) and refuses anything else. Nothing here approves on its own.
 */
import { runClosePlanStep } from "@/app/(app)/chat/actions";
import { postJson } from "@/components/b/api";
import type { RunnerControl } from "@/lib/close-out/runner-model";

export type OpResult = { ok: true; message: string; runId?: string } | { ok: false; error: string };

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

async function sendLetters(ids: string[], requestedBy: string): Promise<OpResult> {
  let sent = 0;
  for (const id of ids) {
    const r = await postJson(`/api/outreach/${id}/send`, { requestedBy });
    if (!r.ok) {
      return { ok: false, error: sent ? `Sent ${plural(sent, "letter")}, then stopped: ${r.error}` : r.error };
    }
    sent += 1;
  }
  return { ok: true, message: `Sent ${plural(sent, "letter")} through Lob TEST mode. Nothing is mailed.` };
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

export async function runOp(state: string, control: RunnerControl, approver: string): Promise<OpResult> {
  const name = approver.trim();
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
      return { ok: true, message: `Composed ${plural(s.composed, "letter")}: ${s.ready} ready for your approval${s.blocked ? `, ${s.blocked} need fixing` : ""}. Nothing was sent.` };
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
      return { ok: true, message: `${name} approved ${plural(approved, "letter")}${failed ? ` (${failed} blocked)` : ""}. Nothing was sent.` };
    }
    case "send_letters":
      if (!name) return { ok: false, error: "Type your name before sending." };
      return sendLetters(control.outreachIds, name);
    case "approve_report": {
      if (!name) return { ok: false, error: "Type your name to approve." };
      const r = await postJson(`/api/reports/${control.reportId}/approve`, { approvedBy: name, expectedChecksum: control.expectedChecksum });
      if (!r.ok) return { ok: false, error: r.error };
      const pack = await freezeEvidencePack(control.reportId);
      return { ok: true, message: `${name} approved this exact file. Nothing is filed until you run the agent.${pack ? "" : " The evidence pack could not be built yet; download it from Reports."}` };
    }
    case "run_filing": {
      const r = await postJson<{ runId: string }>("/api/agents/file", { reportId: control.reportId, state });
      return r.ok ? { ok: true, message: "Filing agent started on the replica portal.", runId: r.data.runId } : { ok: false, error: r.error };
    }
  }
}
