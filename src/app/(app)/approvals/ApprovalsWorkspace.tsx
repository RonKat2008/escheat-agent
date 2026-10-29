"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Money, StatusPill } from "@/components/primitives";
import { DateCell } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { FILTERS, KIND_META } from "./kinds";
import { OutreachDetail } from "./OutreachDetail";
import { ClaimDetail, ReportDetail, RuleDetail } from "./OtherDetails";
import type { QueueData, QueueEntry, QueueKind } from "./queue-data";

function writeSelection(key: string) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sel", key);
    window.history.replaceState(null, "", url);
  } catch {
    /* history unavailable */
  }
}

function Row({ entry, selected, onSelect }: { entry: QueueEntry; selected: boolean; onSelect: () => void }) {
  const Meta = KIND_META[entry.kind];
  const showPill = !["draft", "awaiting_approval"].includes(entry.statusKey);
  return (
    <li>
      <button
        type="button"
        data-key={entry.key}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "bg-raised" : "hover:bg-raised/60",
          !entry.actionable && "opacity-80",
        )}
      >
        {selected ? <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-0.5 rounded-full bg-at-risk" /> : null}
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-muted-foreground">
          <Meta.icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5 font-medium">{entry.title.replace(/^[^·]+· /, "") || entry.title}</span>
          <span className="block truncate text-xs leading-5 text-muted-foreground">
            {Meta.label}
            {entry.subtitle ? ` · ${entry.subtitle}` : ""}
          </span>
          {showPill ? <StatusPill status={entry.statusKey} className="mt-1.5" /> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-[13px]" /> : <span className="text-xs text-muted-foreground">Review</span>}
          {entry.dueDate ? <DateCell date={entry.dueDate} className="text-xs text-muted-foreground" /> : null}
        </span>
      </button>
    </li>
  );
}

export function ApprovalsWorkspace({ data, initialKey }: { data: QueueData; initialKey: string | null }) {
  const [filter, setFilter] = useState<"all" | QueueKind>("all");
  const visible = useMemo(() => data.entries.filter((e) => filter === "all" || e.kind === filter), [data.entries, filter]);
  const todo = visible.filter((e) => e.actionable);
  const done = visible.filter((e) => !e.actionable);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialKey));
  const listRef = useRef<HTMLDivElement>(null);

  const selected = visible.find((e) => e.key === selectedKey) ?? visible[0] ?? null;

  const select = (key: string, fromUser = true) => {
    setSelectedKey(key);
    if (fromUser) setMobileDetail(true);
    writeSelection(key);
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = visible.findIndex((v) => v.key === selected?.key);
      if (e.key === "j" || e.key === "k") {
        const next = visible[idx + (e.key === "j" ? 1 : -1)];
        if (next) {
          e.preventDefault();
          setSelectedKey(next.key);
          writeSelection(next.key);
          listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "a") {
        // Focuses Approve; never triggers it. Approving is always an explicit click or Enter on the button.
        document.getElementById("approve-btn")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected?.key]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data.entries.filter((e) => e.actionable).length };
    for (const e of data.entries) if (e.actionable) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [data.entries]);

  if (data.entries.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface p-6">
        <EmptyState
          title="Nothing needs approval"
          description="The agent is watching your ledger. When an item reaches its due-diligence window, the letter lands here for your review. Nothing is sent without you."
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[372px_minmax(0,1fr)] lg:items-stretch">
      <div ref={listRef} className={cn("min-w-0 rounded-[14px] border border-border bg-surface lg:flex lg:flex-col", mobileDetail && "max-lg:hidden")}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
          <h2 className="text-[15px] font-semibold">
            Queue <span className="ml-1 font-mono text-sm text-muted-foreground tabular-nums" data-testid="queue-count">{counts.all}</span>
          </h2>
          <span className="hidden text-xs text-muted-foreground lg:inline">
            <kbd className="rounded border border-border px-1 font-mono">j</kbd> <kbd className="rounded border border-border px-1 font-mono">k</kbd> to move
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none]" role="group" aria-label="Filter queue">
          {FILTERS.filter((f) => f.id === "all" || (counts[f.id] ?? 0) > 0 || filter === f.id).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-8 max-sm:h-10 shrink-0 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                filter === f.id ? "border-strong bg-raised text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1 font-mono tabular-nums opacity-70">{f.id === "all" ? counts.all : (counts[f.id] ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="max-h-[calc(100vh-15rem)] overflow-y-auto px-1.5 pb-2 lg:max-h-[calc(100vh-17rem)] lg:min-h-0 lg:flex-1">
          {visible.length === 0 ? <EmptyState title="Nothing in this filter" description="Try All to see the full queue." className="px-3" /> : null}
          {todo.length > 0 ? (
            <ul className="space-y-0.5" aria-label="Awaiting you">
              {todo.map((e) => (
                <Row key={e.key} entry={e} selected={e.key === selected?.key} onSelect={() => select(e.key)} />
              ))}
            </ul>
          ) : null}
          {done.length > 0 ? (
            <>
              <h3 className="px-3 pt-4 pb-1.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Recently handled</h3>
              <ul className="space-y-0.5" aria-label="Recently handled">
                {done.map((e) => (
                  <Row key={e.key} entry={e} selected={e.key === selected?.key} onSelect={() => select(e.key)} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <div className={cn("min-w-0 rounded-[14px] border border-border bg-surface", !mobileDetail && "max-lg:hidden")}>
        <button
          type="button"
          onClick={() => setMobileDetail(false)}
          className="flex h-11 w-full items-center gap-2 border-b border-border px-4 text-sm text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to queue
        </button>
        {selected ? (
          <div key={selected.key} data-testid="approval-detail">
            {selected.outreach ? (
              <OutreachDetail entry={selected} env={data.env} onSelectKey={(k) => select(k, false)} />
            ) : selected.report ? (
              <ReportDetail entry={selected} />
            ) : selected.claim ? (
              <ClaimDetail entry={selected} />
            ) : (
              <RuleDetail entry={selected} />
            )}
          </div>
        ) : (
          <EmptyState title="Select an item" description="Pick something from the queue to see exactly what will happen." className="p-6" />
        )}
      </div>
    </div>
  );
}
