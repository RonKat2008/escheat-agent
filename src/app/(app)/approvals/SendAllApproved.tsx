"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { postJson } from "@/components/b/api";
import { Money } from "@/components/primitives";
import { toOperatorMessage } from "@/lib/settings/operator-copy";
import { notify } from "./notify";
import type { QueueData, QueueEntry } from "./queue-data";

interface SendAllResponse {
  items: ({ outreachId: string; outcome: "sent" | "offline" } | { outreachId: string; outcome: "failed"; code: string; error: string })[];
  summary: { sent: number; offline: number; failed: number };
  remaining: number;
}

/** Plain summary of a run. Offline is never called "sent" (honest labelling). */
export function sendAllSummary(s: SendAllResponse["summary"]): string {
  const parts = [
    s.sent > 0 ? `${s.sent} sent in test mode` : null,
    s.offline > 0 ? `${s.offline} OFFLINE — not sent` : null,
    s.failed > 0 ? `${s.failed} not sent (see the row)` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing was approved to send.";
}

/**
 * Biggest opportunity #5: one bar for every approved, unsent notice. Each send still runs the single-item executor on
 * the server (approval of the exact payload, allowlist, Lob test key). Offline, the bar and the result say
 * "OFFLINE — not sent" instead of pretending anything went out.
 */
export function SendAllApproved({ entries, env, onFailed }: { entries: readonly QueueEntry[]; env: QueueData["env"]; onFailed: (reasons: Record<string, string>) => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const approved = entries.filter((e) => e.outreach?.status === "approved");
  if (approved.length === 0 && !result) return null;
  const cents = approved.reduce((a, e) => a + (e.amountCents ?? 0), 0);
  const mode = env.offline ? "OFFLINE — nothing will be mailed" : "Lob test mode";

  async function sendAll() {
    setBusy(true);
    setResult(null);
    const r = await postJson<SendAllResponse>("/api/outreach/send-approved", {});
    setBusy(false);
    if (!r.ok) {
      notify.error("Send all failed", { description: toOperatorMessage(r.error).plain });
      return;
    }
    const line = sendAllSummary(r.data.summary);
    setResult(line);
    onFailed(Object.fromEntries(r.data.items.flatMap((i) => (i.outcome === "failed" ? [[i.outreachId, `Not sent: ${toOperatorMessage(i.error).plain}`]] : []))));
    if (r.data.summary.failed > 0) notify.warning("Some approved notices were not sent", { description: line });
    else notify.success(r.data.summary.offline > 0 ? "Offline: nothing was sent" : "Sent in test mode", { description: line });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-fg-1/[0.04] px-4 py-2.5 text-[13px]" data-testid="send-all-bar">
      {approved.length > 0 ? (
        <>
          <p className="text-fg-1">
            <span className="num font-medium" data-testid="send-all-count">
              {approved.length}
            </span>{" "}
            approved, <Money cents={cents} className="font-medium text-fg-1" /> <span className="text-fg-3">· {mode}</span>
          </p>
          <ActionButton variant="primary" pending={busy} onClick={sendAll} data-testid="send-all-btn">
            <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
            {env.offline ? "Send all (offline)" : "Send all approved"}
          </ActionButton>
        </>
      ) : null}
      {result ? (
        <p role="status" className="w-full text-xs text-fg-2" data-testid="send-all-result">
          {result}
        </p>
      ) : null}
    </div>
  );
}
