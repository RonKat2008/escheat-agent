"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog as DrawerPrimitive } from "@base-ui/react/dialog";
import { useQueryStates } from "nuqs";
import { Search, X } from "lucide-react";
import { EmptyState, Money } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import type { PayeeDetail, PayeeRow } from "@/lib/payees/review-queries";
import type { PayeeChange } from "@/lib/payees/review-types";
import { cn } from "@/lib/utils";
import { previewPayeeChangeAction } from "./actions";
import { BasisCell } from "./basis-cell";
import { ChangeDialog, type PendingChange } from "./change-dialog";
import { PayeeDrawerBody, type PickerRow } from "./payee-drawer";
import { BASIS_OPTIONS, payeesParsers, SHOW_OPTIONS } from "./params";

const SELECT =
  "h-8 rounded-md border border-line bg-ink-1 px-2 text-[13px] text-fg-1 outline-none hover:border-line-hover focus-visible:border-blue-400";
const QUEUE_LIMIT = 6;

interface QueuePair {
  key: string;
  keep: PickerRow;
  merge: PickerRow;
  score: number;
  kind: string;
}

/** Unique suggested pairs: those with money at stake first, then strongest match. The payee with more items is kept. */
function buildQueue(all: readonly PickerRow[]): QueuePair[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const pairs = new Map<string, QueuePair>();
  for (const r of all) {
    for (const s of r.suggestions) {
      const o = byId.get(s.otherId);
      if (!o) continue;
      const key = [r.id, o.id].sort().join(":");
      if (pairs.has(key)) continue;
      const [keep, merge] = r.itemCount >= o.itemCount ? [r, o] : [o, r];
      pairs.set(key, { key, keep, merge, score: s.score, kind: s.kind });
    }
  }
  const stake = (p: QueuePair) => p.keep.outstandingCents + p.merge.outstandingCents;
  return [...pairs.values()].sort((a, b) => stake(b) - stake(a) || b.score - a.score || a.key.localeCompare(b.key));
}

function ReviewQueue({ pairs, onReview }: { pairs: QueuePair[]; onReview: (c: PayeeChange) => void }) {
  if (pairs.length === 0) return null;
  return (
    <section aria-labelledby="queue-h" data-testid="review-queue" className="mb-6 rounded-lg border border-pink-500/50 bg-pink-900/30 p-4">
      <h2 id="queue-h" className="text-sm font-medium text-pink-300">
        {pairs.length} {pairs.length === 1 ? "pair needs" : "pairs need"} a decision
      </h2>
      <p className="mt-1 text-[13px] text-fg-2">Similar names kept apart. Merging changes which state owns the items, and you see that before anything is saved.</p>
      <ul className="mt-3 divide-y divide-pink-500/20">
        {pairs.slice(0, QUEUE_LIMIT).map((p) => (
          <li key={p.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2" data-testid="review-pair">
            <span className="min-w-0 flex-1 basis-56 text-[13px] text-fg-1">
              {p.keep.canonicalName} <span className="text-fg-3">and</span> {p.merge.canonicalName}
            </span>
            <span className="text-xs text-fg-2">
              {p.kind === "likely" ? "Likely duplicate" : "Ambiguous"} <span className="num">{Math.round(p.score * 100)}%</span>
            </span>
            <Button size="sm" variant="outline" onClick={() => onReview({ kind: "merge", keepId: p.keep.id, mergeId: p.merge.id })}>
              Review merge<span className="sr-only">: {p.merge.canonicalName} into {p.keep.canonicalName}</span>
            </Button>
          </li>
        ))}
      </ul>
      {pairs.length > QUEUE_LIMIT ? <p className="mt-2 text-xs text-fg-3">{pairs.length - QUEUE_LIMIT} more are in the table below (filter: Needs review).</p> : null}
    </section>
  );
}

function PayeeTable({ rows, onOpen }: { rows: PayeeRow[]; onOpen: (id: string) => void }) {
  return (
    <table className="w-full text-[13px]" aria-label="Payees">
      <thead className="bg-ink-0">
        <tr className="shadow-[inset_0_-1px_0_var(--color-line)]">
          <th scope="col" className="h-9 px-3 text-left text-xs font-normal text-fg-3">Payee</th>
          <th scope="col" className="hidden h-9 px-3 text-right text-xs font-normal text-fg-3 sm:table-cell">Items</th>
          <th scope="col" className="h-9 px-3 text-right text-xs font-normal text-fg-3">Outstanding</th>
          <th scope="col" className="hidden h-9 px-3 text-left text-xs font-normal text-fg-3 md:table-cell">Owner state</th>
          <th scope="col" className="hidden h-9 px-3 text-left text-xs font-normal text-fg-3 sm:table-cell">Merge basis</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            data-testid="payee-row"
            data-review={r.needsReview || undefined}
            onClick={() => onOpen(r.id)}
            className={cn("cursor-pointer border-b border-line align-top hover:bg-ink-2", r.needsReview && "shadow-[inset_2px_0_0_var(--color-pink-500)]")}
          >
            <td className="px-3 py-2.5">
              <button
                type="button"
                aria-label={`Open ${r.canonicalName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(r.id);
                }}
                className="block max-w-full rounded-sm text-left font-medium text-fg-1"
              >
                {r.canonicalName}
              </button>
              {r.aliases.length ? (
                <p className="mt-0.5 max-w-md truncate text-xs text-fg-3" title={r.aliases.join(", ")}>
                  Also: {r.aliases.join(", ")}
                </p>
              ) : null}
              {r.needsReview ? (
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-5 items-center rounded-full bg-pink-500 px-2 text-xs leading-none font-medium text-black">Review</span>
                  <span className="text-xs text-pink-300">{r.reasons[0]}</span>
                </p>
              ) : null}
              <p className="mt-1 text-xs text-fg-3 sm:hidden">
                {r.itemCount} items, {r.ownerStates.join(", ") || "no open state"}, <BasisCell row={r} />
              </p>
            </td>
            <td className="hidden px-3 py-2.5 text-right text-fg-2 sm:table-cell">
              <span className="num">{r.itemCount}</span>
            </td>
            <td className="px-3 py-2.5 text-right">
              <Money cents={r.outstandingCents} className="font-medium text-fg-1" />
            </td>
            <td className="hidden px-3 py-2.5 text-fg-2 md:table-cell">{r.ownerStates.join(", ") || <span className="text-fg-3 italic">None open</span>}</td>
            <td className="hidden px-3 py-2.5 sm:table-cell">
              <BasisCell row={r} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PayeesClient({ rows, allRows, detail }: { rows: PayeeRow[]; allRows: PickerRow[]; detail: PayeeDetail | null }) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(payeesParsers, { shallow: false, startTransition, clearOnDefault: true });
  const [search, setSearch] = useState(params.q ?? "");
  const [change, setChange] = useState<PendingChange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if ((params.q ?? "") === search.trim()) return;
    const t = setTimeout(() => void setParams({ q: search.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [search, params.q, setParams]);

  async function requestChange(c: PayeeChange) {
    setNotice(null);
    setChange({ change: c, preview: null, error: null });
    const res = await previewPayeeChangeAction({ change: c });
    setChange((cur) => (cur && cur.change === c ? { change: c, preview: res.ok ? res.preview : null, error: res.ok ? null : res.error } : cur));
  }

  const filterCount = [params.q, params.state, params.show, params.basis].filter(Boolean).length;
  const clearAll = () => {
    setSearch("");
    void setParams({ q: null, state: null, show: null, basis: null });
  };
  const queue = buildQueue(allRows);
  const drawerOpen = params.payee !== null && detail !== null;
  const open = (id: string | null) => void setParams({ payee: id });

  return (
    <div data-pending={pending || undefined} className={cn("transition-opacity duration-150", pending && "opacity-70")}>
      {notice ? (
        <p role="status" data-testid="payee-notice" className="mb-4 rounded-md border border-line-hover bg-ink-2 px-3 py-2 text-[13px] text-fg-1">
          {notice}
        </p>
      ) : null}
      <ReviewQueue pairs={queue} onReview={(c) => void requestChange(c)} />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filter payees">
        <label className="relative w-full sm:w-60">
          <span className="sr-only">Search payee or alias</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" strokeWidth={1.5} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payee or alias"
            className="h-8 w-full rounded-md border border-line bg-ink-1 pr-2 pl-8 text-[13px] text-fg-1 outline-none placeholder:text-fg-3 hover:border-line-hover focus-visible:border-blue-400"
          />
        </label>
        <label>
          <span className="sr-only">Owner state</span>
          <select className={SELECT} value={params.state ?? ""} onChange={(e) => void setParams({ state: e.target.value || null })}>
            <option value="">Any state</option>
            {["CA", "DE", "TX"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Show</span>
          <select className={SELECT} value={params.show ?? ""} onChange={(e) => void setParams({ show: e.target.value || null })}>
            <option value="">All payees</option>
            {SHOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Merge basis</span>
          <select className={SELECT} value={params.basis ?? ""} onChange={(e) => void setParams({ basis: e.target.value || null })}>
            <option value="">Any basis</option>
            {BASIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {filterCount > 0 ? (
          <Button size="sm" variant="ghost" onClick={clearAll}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="-mx-4 sm:mx-0">
        {rows.length ? (
          <PayeeTable rows={rows} onOpen={open} />
        ) : (
          <EmptyState
            className="px-4 sm:px-3"
            title="No payees match these filters"
            description="Clear a filter or search for a different name."
            action={
              filterCount > 0 ? (
                <Button size="sm" variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )}
        <p data-testid="payees-footer" className="border-t border-line px-4 py-2.5 text-[13px] text-fg-3 sm:px-3">
          <span className="num text-fg-1">{rows.length}</span> of <span className="num">{allRows.length}</span> payees
        </p>
      </div>

      <DrawerPrimitive.Root open={drawerOpen} onOpenChange={(o) => !o && open(null)} modal={false} disablePointerDismissal>
        <DrawerPrimitive.Portal>
          <div aria-hidden onClick={() => open(null)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />
          <DrawerPrimitive.Popup
            initialFocus={() => window.matchMedia("(max-width: 1023px)").matches}
            data-testid="payee-drawer"
            aria-label="Payee details"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-hover bg-ink-1 text-sm shadow-[var(--shadow-overlay)] outline-none transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-full data-starting-style:translate-x-full sm:w-[520px]"
          >
            <DrawerPrimitive.Title className="sr-only">Payee details</DrawerPrimitive.Title>
            <DrawerPrimitive.Close
              aria-label="Close payee details"
              className="absolute top-3.5 right-3.5 z-10 grid size-8 place-items-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-ink-3 hover:text-fg-1"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </DrawerPrimitive.Close>
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              {detail ? <PayeeDrawerBody detail={detail} all={allRows} onChange={(c) => void requestChange(c)} /> : null}
            </div>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>

      <ChangeDialog
        pending={change}
        onCancel={() => setChange(null)}
        onApplied={(res, c) => {
          setChange(null);
          setNotice(res.applied ? `${res.preview.summary} Recorded as a human decision.` : "Nothing changed.");
          if (c.kind === "merge" && params.payee === c.mergeId) void setParams({ payee: c.keepId });
          if (c.kind === "split" && res.payeeId) void setParams({ payee: res.payeeId });
        }}
      />
    </div>
  );
}
