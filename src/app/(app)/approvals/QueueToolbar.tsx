"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ListChecks, PenLine } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { postJson } from "@/components/b/api";
import { notify } from "./notify";
import { plainLanguage } from "./plain-language";
import type { QueueEntry } from "./queue-data";

type Channel = "letter" | "email" | "voice";
const CHANNELS: Channel[] = ["letter", "email", "voice"];
const PLURAL: Record<Channel, string> = { letter: "letters", email: "emails", voice: "calls" };
const SINGULAR: Record<Channel, string> = { letter: "letter", email: "email", voice: "call" };

interface ComposeAllResponse {
  results: ({ outreachId: string; status: "composed"; ready: boolean; problems: string[] } | { outreachId: string; status: "failed"; reason: string })[];
  summary: { composed: number; ready: number; blocked: number; failed: number; remaining: number };
}

/** Drafts the agent queued but never composed: Compose all fills them in (POST /api/outreach/compose-all). */
export function uncomposedByChannel(entries: readonly QueueEntry[]): Record<Channel, number> {
  const out: Record<Channel, number> = { letter: 0, email: 0, voice: 0 };
  for (const e of entries) {
    const o = e.outreach;
    if (o && !o.composed && ["draft", "awaiting_approval"].includes(o.status)) out[o.channel] += 1;
  }
  return out;
}

/**
 * The queue's bulk actions (R2-04): "Compose all" composes every uncomposed draft and re-checks it (it records no
 * approval and sends nothing), and "Select ready" puts every ready draft of one type into the bulk approval, which
 * still asks for a named approver and a confirm.
 */
export function QueueToolbar({
  entries,
  readySelectable,
  onSelectReady,
  onComposed,
}: {
  entries: readonly QueueEntry[];
  /** Ready drafts that can join one bulk approval, of the channel with the most of them. */
  readySelectable: { channel: Channel; keys: string[] } | null;
  onSelectReady: (keys: string[]) => void;
  /** Block reasons per outreach id from the composer, in plain language. */
  onComposed: (reasons: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const counts = uncomposedByChannel(entries);
  const total = CHANNELS.reduce((a, c) => a + counts[c], 0);

  async function composeAll() {
    setBusy(true);
    const totals = { composed: 0, ready: 0, blocked: 0, failed: 0, remaining: 0 };
    const reasons: Record<string, string> = {};
    let error: string | null = null;
    for (const channel of CHANNELS.filter((c) => counts[c] > 0)) {
      const r = await postJson<ComposeAllResponse>("/api/outreach/compose-all", { channel });
      if (!r.ok) {
        error = r.error;
        break;
      }
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r.data.summary[k];
      for (const x of r.data.results) {
        if (x.status === "composed" && !x.ready && x.problems.length) reasons[x.outreachId] = `Blocked: ${plainLanguage(x.problems[0]!)}`;
        if (x.status === "failed") reasons[x.outreachId] = `Couldn't compose: ${plainLanguage(x.reason)}`;
      }
    }
    setBusy(false);
    onComposed(reasons);
    if (error) notify.error("Compose all stopped", { description: plainLanguage(error) });
    else
      notify.success(`Composed ${totals.composed}: ${totals.ready} ready, ${totals.blocked} blocked`, {
        description: `${totals.failed ? `${totals.failed} failed. ` : ""}${totals.remaining ? `${totals.remaining} more left; run it again. ` : ""}Nothing was approved or sent.`,
      });
    startTransition(() => router.refresh());
  }

  if (total === 0 && !readySelectable) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5" role="group" aria-label="Queue actions">
      {total > 0 ? (
        <ActionButton variant="quiet" pending={busy} onClick={composeAll} data-testid="compose-all">
          <PenLine className="size-3.5" strokeWidth={1.5} aria-hidden />
          Compose all <span className="num font-mono text-fg-2">{total}</span>
        </ActionButton>
      ) : null}
      {readySelectable ? (
        <ActionButton variant="quiet" onClick={() => onSelectReady(readySelectable.keys)} data-testid="select-ready">
          <ListChecks className="size-3.5" strokeWidth={1.5} aria-hidden />
          Select {readySelectable.keys.length} ready {readySelectable.keys.length === 1 ? SINGULAR[readySelectable.channel] : PLURAL[readySelectable.channel]}
        </ActionButton>
      ) : null}
    </div>
  );
}
