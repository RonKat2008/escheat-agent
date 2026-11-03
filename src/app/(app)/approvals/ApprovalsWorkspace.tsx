"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateCell, EmptyState, Kbd, Money, StatusPill } from "@/components/primitives";
import { RowCheckbox } from "@/components/b/RowCheckbox";
import { buttonVariants } from "@/components/ui/button";
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import { cn } from "@/lib/utils";
import { BulkApproveBar, bulkBlockReason } from "./BulkApprove";
import { FILTERS, KIND_META } from "./kinds";
import { OutreachDetail } from "./OutreachDetail";
import { OverdueNote } from "./OverdueNote";
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
function Row({
  entry,
  selected,
  onSelect,
  check,
}: {
  entry: QueueEntry;
  selected: boolean;
  onSelect: () => void;
  /** Present for pending outreach rows; the checkbox adds the row to a bulk approval. */
  check?: { checked: boolean; blocked: string | null; onToggle: (checked: boolean) => void };
}) {
  const Meta = KIND_META[entry.kind];
  const showPill = !["draft", "awaiting_approval"].includes(entry.statusKey);
  return (
    <li className="flex items-stretch">
      <span className="flex w-10 shrink-0 items-start justify-center pt-1.5">
        {check ? (
          <RowCheckbox
            label={`Select ${entry.title.replace(/^[^·]+· /, "")} for bulk approval`}
            checked={check.checked}
            disabled={check.blocked !== null}
            title={check.blocked ?? undefined}
            onToggle={check.onToggle}
            data-testid="approval-select"
          />
        ) : null}
      </span>
      <button
        type="button"
        data-key={entry.key}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "group relative flex w-full items-start gap-3 py-3 pr-4 text-left transition-colors duration-150 outline-none focus-visible:bg-ink-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400",
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
          {entry.overdue ? (
            <OverdueNote overdue={entry.overdue} compact />
          ) : entry.dueDate ? (
            <span className="text-xs text-fg-3">
              {entry.dueLabel ? `${entry.dueLabel} ` : ""}
              <DateCell date={entry.dueDate} className="text-xs text-fg-3" />
            </span>
          ) : null}
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
  /** Which way the selection last moved through the list: the next detail rises from that side. */
  const [travel, setTravel] = useState<1 | -1>(1);
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialKey));
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  /** Set by j/k so the next selection change also moves focus to the detail heading (see effect below). */
  const focusDetail = useRef(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const selected = visible.find((e) => e.key === selectedKey) ?? visible[0] ?? null;

  const select = (key: string, fromUser = true) => {
    const from = visible.findIndex((v) => v.key === selected?.key);
    const to = visible.findIndex((v) => v.key === key);
    if (from >= 0 && to >= 0 && to !== from) setTravel(to > from ? 1 : -1);
    setSelectedKey(key);
    if (fromUser) setMobileDetail(true);
    writeSelection(key);
  };

  // Deep links (e.g. a chat approval card's "Review in Approvals") land with the draft selected and in view.
  useEffect(() => {
    if (!initialKey) return;
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(initialKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [initialKey]);

  // j/k change the selection with focus still on <body>; moving it to the new detail heading puts Approve a couple of
  // Tab stops away instead of behind the whole sidebar, and screen readers announce what was selected.
  const selectedKeyNow = selected?.key;
  useEffect(() => {
    if (!focusDetail.current) return;
    const heading = detailRef.current?.querySelector<HTMLElement>("[data-detail-heading]");
    if (!heading) return;
    focusDetail.current = false;
    heading.focus({ preventScroll: true });
  }, [selectedKeyNow]);

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
          focusDetail.current = true;
          setTravel(e.key === "j" ? 1 : -1);
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

  const checkedEntries = data.entries.filter((e) => checked.has(e.key));
  const bulkChannel = checkedEntries[0]?.outreach?.channel;
  // Only pending drafts of ONE type can be approved together.
  const checkFor = (e: QueueEntry) => {
    if (!e.outreach || !e.actionable) return undefined;
    const base = bulkBlockReason(e, data.env);
    const blocked =
      base ??
      (bulkChannel && e.outreach.channel !== bulkChannel && !checked.has(e.key)
        ? "Select one type at a time."
        : checked.size >= BULK_MAX && !checked.has(e.key)
          ? `At most ${BULK_MAX} per batch.`
          : null);
    return {
      checked: checked.has(e.key),
      blocked,
      onToggle: (on: boolean) =>
        setChecked((prev) => {
          const next = new Set(prev);
          if (on) next.add(e.key);
          else next.delete(e.key);
          return next;
        }),
    };
  };

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
          action={
            <Link href="/items?sort=deadline_asc" className={buttonVariants({ size: "sm", variant: "outline" })}>
              See upcoming deadlines
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="-mx-4 grid grid-cols-[minmax(0,1fr)] items-start overflow-clip border-y border-line bg-ink-1 sm:mx-0 sm:rounded-xl sm:border-x lg:grid-cols-[360px_minmax(0,1fr)] lg:items-stretch">
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
        <div className={cn("pb-2 lg:min-h-0 lg:flex-1", checked.size > 0 && "max-lg:pb-16")}>
          {visible.length === 0 ? (
            <EmptyState
              title="Nothing in this filter"
              description="Everything of this kind has been handled."
              className="px-4"
              action={
                <button type="button" onClick={() => setFilter("all")} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Show the full queue
                </button>
              }
            />
          ) : null}
          {todo.length > 0 ? (
            <ul className="divide-y divide-line" aria-label="Awaiting you">
              {todo.map((e) => (
                <Row key={e.key} entry={e} selected={e.key === selected?.key} onSelect={() => select(e.key)} check={checkFor(e)} />
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
        {/* lg: sticky footer of the list pane. Below lg the list is short, so the bar is pinned to the viewport bottom instead. */}
        <div className="sticky bottom-0 z-10 max-lg:fixed max-lg:inset-x-0 max-lg:z-30">
          <BulkApproveBar
            entries={checkedEntries}
            env={data.env}
            onClear={() => setChecked(new Set())}
            onApproved={(keys) =>
              setChecked((prev) => {
                const next = new Set(prev);
                for (const k of keys) next.delete(k);
                return next;
              })
            }
          />
        </div>
      </div>

      <div ref={detailRef} className={cn("min-w-0 bg-ink-0", !mobileDetail && "max-lg:hidden")}>
        <button
          type="button"
          onClick={() => setMobileDetail(false)}
          className="flex h-11 w-full items-center gap-2 border-b border-line px-4 text-[13px] text-fg-2 hover:text-fg-1 lg:hidden"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden /> Back to queue
        </button>
        {selected ? (
          <div key={selected.key} data-testid="approval-detail" className="es-detail-in" style={{ ["--es-from-y" as string]: `${travel * 8}px` }}>
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
