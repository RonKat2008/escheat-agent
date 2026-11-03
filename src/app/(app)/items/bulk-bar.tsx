"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { postJson } from "@/components/b/api";
import { Kbd, Money } from "@/components/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PlanEntry, PlanSummary } from "@/lib/outreach/bulk-plan";
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import type { StaleItemRow } from "@/lib/queries";
import { chunk, confirmLabel, groupPlan, type PlanPreview } from "./bulk-plan-view";

type DraftResult =
  | { staleItemId: string; status: "drafted"; outreachId: string; ready: boolean; problems: string[] }
  | { staleItemId: string; status: "skipped"; code?: string; reason: string }
  | { staleItemId: string; status: "failed"; reason: string };

interface Outcome {
  row: StaleItemRow | undefined;
  staleItemId: string;
  result: DraftResult;
}

interface DryRunResponse {
  dryRun: true;
  plan: PlanEntry[];
  summary: PlanSummary;
}

const checkLabel = (n: string | null) => (n ? `#${n}` : "No check #");

/**
 * Bulk draft with a dry-run preview (DESIGN-V3 §5.5 step 2): first POST {dryRun:true} and show what will be drafted and
 * what will be skipped (grouped by the server's reason); only after Confirm does the real run draft the will-draft
 * items. Drafts wait in Approvals; nothing is ever sent from here.
 */
export function useBulkDraft({ onDrafted }: { onDrafted: (ids: string[]) => void }): { busy: boolean; start: (rows: StaleItemRow[]) => void; dialogs: ReactNode } {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<StaleItemRow[]>([]);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

  async function start(selection: StaleItemRow[]) {
    if (selection.length === 0 || busy) return;
    setBusy(true);
    const plan: PlanEntry[] = [];
    for (const ids of chunk(selection.map((r) => r.id), BULK_MAX)) {
      const res = await postJson<DryRunResponse>("/api/outreach/bulk-draft", { channel: "letter", staleItemIds: ids, dryRun: true });
      if (!res.ok) {
        setBusy(false);
        toast.error("Could not preview the drafts", { description: res.error });
        return;
      }
      plan.push(...res.data.plan);
    }
    setBusy(false);
    setRows(selection);
    setPreview(groupPlan(plan, new Map(selection.map((r) => [r.id, { payeeName: r.payeeName, checkNumber: r.checkNumber }]))));
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const collected: Outcome[] = [];
    let failure: string | null = null;
    for (const ids of chunk(preview.willDraft, BULK_MAX)) {
      const res = await postJson<{ results: DraftResult[] }>("/api/outreach/bulk-draft", { channel: "letter", staleItemIds: ids });
      if (!res.ok) {
        failure = res.error;
        break;
      }
      for (const result of res.data.results) collected.push({ row: byId.get(result.staleItemId), staleItemId: result.staleItemId, result });
    }
    // Items the preview already skipped stay reported as skipped, with the server's reason.
    for (const g of preview.groups) {
      for (const e of g.entries) collected.push({ row: byId.get(e.staleItemId), staleItemId: e.staleItemId, result: { staleItemId: e.staleItemId, status: "skipped", code: g.code, reason: e.message } });
    }
    setBusy(false);
    setPreview(null);
    if (failure) toast.error("Could not draft the letters", { description: failure });
    setOutcomes(collected);
    const drafted = collected.filter((o) => o.result.status === "drafted").map((o) => o.staleItemId);
    onDrafted(drafted);
    if (drafted.length > 0) {
      toast.success(`${drafted.length} letter${drafted.length === 1 ? "" : "s"} drafted`, { description: "They are waiting for your approval." });
      router.refresh();
    }
  }

  const drafted = outcomes?.filter((o) => o.result.status === "drafted") ?? [];
  const notDrafted = outcomes?.filter((o) => o.result.status !== "drafted") ?? [];

  const dialogs = (
    <>
      <Dialog open={preview !== null} onOpenChange={(o) => !o && !busy && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-draft-preview">
          <DialogHeader>
            <DialogTitle>{preview?.title ?? "Preview"}</DialogTitle>
            <DialogDescription>Dry run: nothing has been written yet. Confirm to draft the letters below; they will wait in Approvals and nothing is sent.</DialogDescription>
          </DialogHeader>
          {preview && preview.groups.length > 0 ? (
            <div className="space-y-3" data-testid="bulk-skip-groups">
              {preview.groups.map((g) => (
                <section key={g.code} aria-label={`Skipped: ${g.label}`} data-testid="bulk-skip-group" data-code={g.code} className="rounded-md border border-line bg-ink-1 p-2.5">
                  <h3 className="flex items-baseline justify-between gap-3 text-[13px] font-medium text-fg-1">
                    {g.label}
                    <span className="num text-xs font-normal text-fg-3">{g.entries.length} skipped</span>
                  </h3>
                  <ul className="mt-1.5 space-y-1">
                    {g.entries.map((e) => (
                      <li key={e.staleItemId} className="text-xs">
                        <span className="break-words text-fg-1">{e.payeeName}</span> <span className="font-mono text-fg-3">{checkLabel(e.checkNumber)}</span>
                        <p className="text-pink-400">{e.message}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <ActionButton variant="quiet" onClick={() => setPreview(null)} disabled={busy} data-testid="bulk-preview-cancel">
              Cancel
            </ActionButton>
            <ActionButton variant="primary" pending={busy} disabled={!preview || preview.willDraft.length === 0} onClick={() => void confirm()} data-testid="bulk-preview-confirm">
              {preview && preview.willDraft.length > 0 ? confirmLabel(preview.willDraft.length) : "Nothing to draft"}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {notDrafted.map(({ row, staleItemId, result }) => (
                <li key={staleItemId} className="rounded-md border border-line bg-ink-1 p-2.5">
                  <p className="font-medium text-fg-1">
                    {row?.payeeName ?? "Unknown item"} {row ? <span className="font-mono text-xs text-fg-3">{checkLabel(row.checkNumber)}</span> : null}
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

  return { busy, start: (r) => void start(r), dialogs };
}

/** Sticky selection bar: count, total, and the bulk draft action (opens the dry-run preview first). */
export function BulkBar({ rows, busy, onClear, onDraft }: { rows: StaleItemRow[]; busy: boolean; onClear: () => void; onDraft: () => void }) {
  const totalCents = rows.reduce((a, r) => a + r.amount.cents, 0);
  const n = rows.length;
  if (n === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="bulk-bar"
      className="es-bar-in flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-blue-800 bg-blue-900/90 px-4 py-2.5 text-[13px] backdrop-blur-md sm:px-3"
    >
      <p className="text-fg-1" aria-live="polite">
        <span className="num font-medium" data-testid="bulk-count">
          {n}
        </span>{" "}
        selected,{" "}
        <span data-testid="bulk-total">
          <Money cents={totalCents} className="font-medium text-fg-1" />
        </span>
      </p>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1 text-xs text-blue-300 lg:inline-flex">
          <Kbd>x</Kbd> toggle <Kbd>d</Kbd> draft <Kbd>Esc</Kbd> clear
        </span>
        <ActionButton variant="quiet" onClick={onClear} disabled={busy} data-testid="bulk-clear">
          Clear
        </ActionButton>
        <ActionButton variant="primary" pending={busy} onClick={onDraft} data-testid="bulk-draft" aria-keyshortcuts="D">
          <Mail className="size-3.5" aria-hidden />
          Draft outreach for {n} {n === 1 ? "item" : "items"}
        </ActionButton>
      </div>
    </div>
  );
}
