"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { toast } from "@/lib/toast";
import { ActionButton } from "@/components/b/ActionButton";
import { postJson } from "@/components/b/api";
import { Kbd, Money } from "@/components/primitives";
import type { PlanEntry, PlanSummary } from "@/lib/outreach/bulk-plan";
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import type { StaleItemRow } from "@/lib/queries";
import { chunk, groupPlan, type PlanPreview } from "./bulk-plan-view";
import type { BulkDraftResult, BulkOutcome } from "./bulk-types";

const BulkDialogs = dynamic(() => import("./bulk-dialogs"), { ssr: false });

type DraftResult = BulkDraftResult;
type Outcome = BulkOutcome<StaleItemRow>;

interface DryRunResponse {
  dryRun: true;
  plan: PlanEntry[];
  summary: PlanSummary;
}

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
  // The dialogs chunk loads on the first draft and then stays mounted, so closing still animates.
  const [dialogsMounted, setDialogsMounted] = useState(false);

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
    setDialogsMounted(true);
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
    setDialogsMounted(true);
    const drafted = collected.filter((o) => o.result.status === "drafted").map((o) => o.staleItemId);
    onDrafted(drafted);
    if (drafted.length > 0) {
      toast.success(`${drafted.length} letter${drafted.length === 1 ? "" : "s"} drafted`, { description: "They are waiting for your approval." });
      router.refresh();
    }
  }

  const dialogs = dialogsMounted ? (
    <BulkDialogs
      preview={preview}
      outcomes={outcomes}
      busy={busy}
      onClosePreview={() => !busy && setPreview(null)}
      onConfirm={() => void confirm()}
      onCloseOutcomes={() => setOutcomes(null)}
    />
  ) : null;

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
