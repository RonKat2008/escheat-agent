"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { postJson } from "@/components/b/api";
import { Money } from "@/components/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StaleItemRow } from "@/lib/queries";

const BATCH = 50;

type DraftResult =
  | { staleItemId: string; status: "drafted"; outreachId: string; ready: boolean; problems: string[] }
  | { staleItemId: string; status: "skipped" | "failed"; reason: string };

interface Outcome {
  row: StaleItemRow;
  result: DraftResult;
}

/** Sticky selection bar: count, total, and the bulk draft action (drafts only; nothing is sent). */
export function BulkBar({
  rows,
  onClear,
  onDrafted,
}: {
  rows: StaleItemRow[];
  onClear: () => void;
  onDrafted: (draftedIds: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const totalCents = rows.reduce((a, r) => a + r.amount.cents, 0);
  const n = rows.length;

  async function draftAll() {
    setBusy(true);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const collected: Outcome[] = [];
    let failure: string | null = null;
    for (let i = 0; i < rows.length && !failure; i += BATCH) {
      const ids = rows.slice(i, i + BATCH).map((r) => r.id);
      const res = await postJson<{ results: DraftResult[] }>("/api/outreach/bulk-draft", { channel: "letter", staleItemIds: ids });
      if (!res.ok) {
        failure = res.error;
        break;
      }
      for (const result of res.data.results) collected.push({ row: byId.get(result.staleItemId)!, result });
    }
    setBusy(false);
    if (failure) toast.error("Could not draft the letters", { description: failure });
    if (collected.length > 0) {
      setOutcomes(collected);
      const drafted = collected.filter((o) => o.result.status === "drafted");
      onDrafted(drafted.map((o) => o.row.id));
      if (drafted.length > 0) toast.success(`${drafted.length} letter${drafted.length === 1 ? "" : "s"} drafted`, { description: "They are waiting for your approval." });
    }
  }

  const drafted = outcomes?.filter((o) => o.result.status === "drafted") ?? [];
  const notDrafted = outcomes?.filter((o) => o.result.status !== "drafted") ?? [];

  return (
    <>
      {n > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          data-testid="bulk-bar"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-blue-800 bg-blue-900/90 px-4 py-2.5 text-[13px] backdrop-blur-md sm:px-3"
        >
          <p className="text-fg-1" aria-live="polite">
            <span className="num font-medium" data-testid="bulk-count">
              {n}
            </span>{" "}
            selected, <span data-testid="bulk-total"><Money cents={totalCents} className="font-medium text-fg-1" /></span>
          </p>
          <div className="flex items-center gap-2">
            <ActionButton variant="quiet" onClick={onClear} disabled={busy} data-testid="bulk-clear">
              Clear
            </ActionButton>
            <ActionButton variant="primary" pending={busy} onClick={draftAll} data-testid="bulk-draft">
              <Mail className="size-3.5" aria-hidden />
              Draft outreach for {n} {n === 1 ? "item" : "items"}
            </ActionButton>
          </div>
        </div>
      ) : null}

      <Dialog open={outcomes !== null} onOpenChange={(o) => !o && setOutcomes(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-draft-results">
          <DialogHeader>
            <DialogTitle>
              {drafted.length} drafted, {notDrafted.length} skipped
            </DialogTitle>
            <DialogDescription>Drafts wait in Approvals. Nothing has been sent.</DialogDescription>
          </DialogHeader>
          {notDrafted.length > 0 ? (
            <ul className="space-y-2" aria-label="Skipped items">
              {notDrafted.map(({ row, result }) => (
                <li key={row.id} className="rounded-md border border-line bg-ink-1 p-2.5">
                  <p className="font-medium text-fg-1">
                    {row.payeeName} {row.checkNumber ? <span className="font-mono text-xs text-fg-3">#{row.checkNumber}</span> : null}
                  </p>
                  <p className="text-xs text-pink-400">{result.status === "drafted" ? "" : result.reason}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {drafted.some((o) => o.result.status === "drafted" && !o.result.ready) ? (
            <p className="text-xs text-fg-2">Some drafts are not ready to approve; their problems are listed in Approvals.</p>
          ) : null}
          <Link href="/approvals" className="text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
            Review in approvals
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
