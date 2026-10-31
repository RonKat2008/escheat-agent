"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateCell, EmptyState, Kbd, Money, StatusPill } from "@/components/primitives";
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

/** Flat row: kind icon, title, payee/kind line, amount and due date. Selected = blue rail + ink-3. */
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
          "group relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 outline-none focus-visible:bg-ink-2 focus-visible:outline-none",
          selected ? "bg-ink-3" : "hover:bg-ink-2",
        )}
      >
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-0.5 origin-center bg-blue-500 transition-transform duration-150 ease-out", selected ? "scale-y-100" : "scale-y-0")}
        />
        <Meta.icon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-blue-400" : "text-fg-3")} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] leading-5 font-medium", entry.actionable ? "text-fg-1" : "text-fg-2")}>
            {entry.title.replace(/^[^·]+· /, "") || entry.title}
          </span>
          <span className="block truncate text-xs leading-5 text-fg-3">
            {Meta.label}
            {entry.subtitle ? `, ${entry.subtitle}` : ""}
          </span>
          {showPill ? <StatusPill status={entry.statusKey} className="mt-1 text-xs" /> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-[13px] text-fg-1" /> : <span className="text-xs text-fg-3">Review</span>}
          {entry.dueDate ? <DateCell date={entry.dueDate} className="text-xs text-fg-3" /> : null}
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
      <div className="border-t border-line">
        <EmptyState
          title="Nothing needs approval"
          description="The agent is watching your ledger. When an item reaches its due-diligence window, the letter lands here for your review. Nothing is sent without you."
        />
      </div>
    );
  }

  return (
    <div className="-mx-4 grid grid-cols-[minmax(0,1fr)] items-start overflow-hidden border-y border-line bg-ink-1 sm:mx-0 sm:rounded-xl sm:border-x lg:grid-cols-[360px_minmax(0,1fr)] lg:items-stretch">
      <div ref={listRef} className={cn("min-w-0 lg:flex lg:flex-col lg:border-r lg:border-line", mobileDetail && "max-lg:hidden")}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
          <h2 className="text-[13px] font-medium text-fg-1">
            Waiting on you{" "}
            <span className="num ml-1 font-normal text-pink-400" data-testid="queue-count">
              {counts.all}
            </span>
          </h2>
          <span className="hidden items-center gap-1 text-xs text-fg-3 lg:inline-flex">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <span className="ml-0.5">to move</span>
          </span>
        </div>
        <div className="flex gap-4 overflow-x-auto border-b border-line px-4 [scrollbar-width:none]" role="group" aria-label="Filter queue">
          {FILTERS.filter((f) => f.id === "all" || (counts[f.id] ?? 0) > 0 || filter === f.id).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "relative h-10 shrink-0 text-[13px] transition-colors duration-150 focus-visible:outline-offset-[-2px]",
                filter === f.id ? "text-fg-1" : "text-fg-3 hover:text-fg-2",
              )}
            >
              {f.label}
              <span className="num ml-1.5 text-fg-3">{f.id === "all" ? counts.all : (counts[f.id] ?? 0)}</span>
              <span aria-hidden className={cn("absolute inset-x-0 -bottom-px h-0.5 bg-blue-500 transition-opacity duration-150", filter === f.id ? "opacity-100" : "opacity-0")} />
            </button>
          ))}
        </div>
        <div className="max-h-[calc(100vh-15rem)] overflow-y-auto pb-2 lg:max-h-[calc(100vh-16rem)] lg:min-h-0 lg:flex-1">
          {visible.length === 0 ? <EmptyState title="Nothing in this filter" description="Try All to see the full queue." className="px-4" /> : null}
          {todo.length > 0 ? (
            <ul className="divide-y divide-line" aria-label="Awaiting you">
              {todo.map((e) => (
                <Row key={e.key} entry={e} selected={e.key === selected?.key} onSelect={() => select(e.key)} />
              ))}
            </ul>
          ) : null}
          {done.length > 0 ? (
            <>
              <h3 className="border-t border-line px-4 pt-4 pb-1.5 text-xs text-fg-3">Recently handled</h3>
              <ul className="divide-y divide-line" aria-label="Recently handled">
                {done.map((e) => (
                  <Row key={e.key} entry={e} selected={e.key === selected?.key} onSelect={() => select(e.key)} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <div className={cn("min-w-0 bg-ink-0", !mobileDetail && "max-lg:hidden")}>
        <button
          type="button"
          onClick={() => setMobileDetail(false)}
          className="flex h-11 w-full items-center gap-2 border-b border-line px-4 text-[13px] text-fg-2 hover:text-fg-1 lg:hidden"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden /> Back to queue
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
