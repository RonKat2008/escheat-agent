"use client";

import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Kbd } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { ApprovalsPipeline } from "@/components/viz/pipeline/ApprovalsPipeline";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import type { Pipeline } from "@/lib/queries/pipeline";
import { cn } from "@/lib/utils";
import { BulkApproveBar, bulkBlockReason } from "./BulkApprove";
import { findGroup, groupIdOf, groupQueue, type QueueGroup } from "./group";
import { FILTERS } from "./kinds";
import { OutreachDetail, type DetailActions } from "./OutreachDetail";
import { ClaimDetail, ReportDetail, RuleDetail } from "./OtherDetails";
import { OwnerTaskDetail } from "./OwnerTaskDetail";
import { SendAllApproved } from "./SendAllApproved";
import { QueueRow, type RowCheck } from "./QueueRow";
import { QueueToolbar } from "./QueueToolbar";
import type { DeskKind, QueueData, QueueEntry } from "./queue-data";
import { useApprovalKeys } from "./useApprovalKeys";

type Filter = "all" | "ready" | DeskKind;
const TABS: { id: Filter; label: string }[] = [FILTERS[0]!, { id: "ready", label: "Ready to approve" }, ...FILTERS.slice(1)];
/** How long the flip-stamp plays before ⌘↵ moves on to the next draft. */
const ADVANCE_MS = 900;

function writeSelection(key: string) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sel", key);
    window.history.replaceState(null, "", url);
  } catch {
    /* history unavailable */
  }
}

/** Deep-link filters (e.g. the chat close plan's `/approvals?kind=letter&state=CA`). Unknown values are ignored. */
export interface QueueLinkFilter {
  kind: string | null;
  state: string | null;
}

/** The page is already scrolled when the client takes over: the person (or the browser's restore) chose a position. */
function userScrolledBeforeHydration(): boolean {
  return window.scrollY > 0;
}

function tabFrom(kind: string | null): Filter {
  return TABS.find((t) => t.id === kind)?.id ?? "all";
}

function stateFrom(state: string | null): string | null {
  const s = state?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

function matches(e: QueueEntry, filter: Filter, status: string | null, state: string | null): boolean {
  if (state && e.state?.toUpperCase() !== state) return false;
  if (status && e.outreach?.status !== status) return false;
  if (filter === "all") return status ? Boolean(e.outreach) : true;
  if (filter === "ready") return e.outreach?.ready === true;
  return e.kind === filter;
}

export function ApprovalsWorkspace({
  data,
  pipeline,
  initialKey,
  link = { kind: null, state: null },
}: {
  data: QueueData;
  pipeline: Pipeline;
  initialKey: string | null;
  link?: QueueLinkFilter;
}) {
  const [filter, setFilter] = useState<Filter>(() => tabFrom(link.kind));
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(() => stateFrom(link.state));
  // Owner follow-ups lead the desk: an owner is waiting on a reply (owner loop). They count in "Waiting on you" like the rest.
  const entries = useMemo<QueueEntry[]>(() => [...data.ownerTasks, ...data.entries], [data.ownerTasks, data.entries]);
  const allGroups = useMemo(() => groupQueue(entries), [entries]);
  const groups = useMemo(() => groupQueue(entries.filter((e) => matches(e, filter, statusFilter, stateFilter))), [entries, filter, statusFilter, stateFilter]);
  const todo = groups.filter((g) => g.actionable);
  const done = groups.filter((g) => !g.actionable);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  /** Which way the selection last moved through the list: the next detail rises from that side. */
  const [travel, setTravel] = useState<1 | -1>(1);
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialKey));
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  /** Inline block reasons from the server (bulk approve, compose all), per outreach id (R2-04). */
  const [serverBlocked, setServerBlocked] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<DetailActions | null>(null);
  /** Set by keyboard moves so the next selection change also moves focus to the detail heading. */
  const focusDetail = useRef(false);
  const tier = useRenderTier();

  const fullGroup = findGroup(allGroups, selectedKey);
  const selectedGroup: QueueGroup | null = (fullGroup && groups.find((g) => g.id === fullGroup.id)) ?? groups[0] ?? null;
  const selectedFull = selectedGroup ? (allGroups.find((g) => g.id === selectedGroup.id) ?? selectedGroup) : null;
  const selected = selectedFull ? (selectedFull.members.find((m) => m.key === selectedKey) ?? selectedGroup!.lead) : null;

  const scrollToRow = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });

  const select = (key: string, opts: { fromUser?: boolean; viaKeyboard?: boolean } = {}) => {
    const fromIdx = groups.findIndex((g) => g.id === selectedGroup?.id);
    const target = findGroup(allGroups, key);
    const toIdx = groups.findIndex((g) => g.id === target?.id);
    if (fromIdx >= 0 && toIdx >= 0 && toIdx !== fromIdx) setTravel(toIdx > fromIdx ? 1 : -1);
    if (opts.viaKeyboard) focusDetail.current = true;
    setSelectedKey(key);
    if (opts.fromUser !== false) setMobileDetail(true);
    writeSelection(key);
  };

  // Deep links (e.g. a chat approval card's "Review in Approvals") land with the draft selected and in view. This runs
  // after hydration, which can be seconds after the page is readable on a slow device: if the person has already
  // scrolled by then, their position wins (CI: a scroll to the approve bar was yanked back up to the list row).
  useEffect(() => {
    if (initialKey && !userScrolledBeforeHydration()) scrollToRow(initialKey);
  }, [initialKey]);

  // Keyboard moves leave focus on <body>; moving it to the new detail heading puts Approve a couple of Tab stops away.
  const selectedNow = selected?.key;
  useEffect(() => {
    if (!focusDetail.current) return;
    const heading = detailRef.current?.querySelector<HTMLElement>("[data-detail-heading]");
    if (!heading) return;
    focusDetail.current = false;
    heading.focus({ preventScroll: true });
  }, [selectedNow]);

  const move = (dir: 1 | -1) => {
    const idx = groups.findIndex((g) => g.id === selectedGroup?.id);
    const next = groups[idx + dir];
    if (!next) return false;
    setTravel(dir);
    select(next.lead.key, { fromUser: false, viaKeyboard: true });
    scrollToRow(next.lead.key);
    return true;
  };

  /** After an approval: the next waiting step of the same owner (letter → email → call), else the next waiting row. */
  const nextAfter = (key: string): string | null => {
    const g = findGroup(allGroups, key);
    const sibling = g?.members.find((m) => m.actionable && m.key !== key && m.outreach && ["draft", "awaiting_approval"].includes(m.outreach.status));
    if (sibling) return sibling.key;
    const idx = groups.findIndex((x) => x.id === g?.id);
    return groups.slice(idx + 1).find((x) => x.actionable)?.lead.key ?? null;
  };

  useApprovalKeys({
    onMove: move,
    onApprove: async (advance) => {
      const act = actionsRef.current;
      if (!act?.approve) {
        document.getElementById("approve-btn")?.focus();
        return;
      }
      const from = selected?.key;
      const ok = await act.approve();
      if (!ok || !advance || !from) return;
      const next = nextAfter(from);
      if (next) window.setTimeout(() => {
        select(next, { fromUser: false, viaKeyboard: true });
        scrollToRow(next);
      }, tier === "static" ? 0 : ADVANCE_MS);
    },
    onEdit: () => actionsRef.current?.edit(),
  });

  const checkedEntries = entries.filter((e) => checked.has(e.key));
  const bulkChannel = checkedEntries[0]?.outreach?.channel;
  // Only pending drafts of ONE type can be approved together.
  const checkFor = (e: QueueEntry): RowCheck | undefined => {
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

  /** Shown on the row: the server's reason first, else the composer's first problem. Uncomposed drafts are not "blocked". */
  const blockedFor = (e: QueueEntry): string | null => {
    const o = e.outreach;
    if (!o || !e.actionable) return null;
    if (serverBlocked[o.id]) return serverBlocked[o.id]!;
    if (o.status === "approved") return null;
    if (o.composed && !o.readiness.ready) return `Blocked: ${o.readiness.problems[0] ?? "fix the problems on the draft."}`;
    if (o.channel === "letter" && !o.hasOwnerAddress) return "Blocked: no complete mailing address for the owner.";
    return null;
  };

  const readySelectable = useMemo(() => {
    const by = new Map<"letter" | "email" | "voice", string[]>();
    for (const e of data.entries) {
      if (!e.outreach?.ready || bulkBlockReason(e, data.env)) continue;
      by.set(e.outreach.channel, [...(by.get(e.outreach.channel) ?? []), e.key]);
    }
    const best = [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    return best ? { channel: best[0], keys: best[1].slice(0, BULK_MAX) } : null;
  }, [data.entries, data.env]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.filter((e) => e.actionable).length, ready: 0 };
    for (const e of entries) {
      if (e.actionable) c[e.kind] = (c[e.kind] ?? 0) + 1;
      if (e.outreach?.ready) c.ready = (c.ready ?? 0) + 1;
    }
    return c;
  }, [entries]);

  const pipelineView = (
    <ApprovalsPipeline
      pipeline={pipeline}
      activeStatus={statusFilter}
      onSelectOutreach={(s) => {
        setStatusFilter((prev) => (prev === s ? null : s));
        setFilter("all");
      }}
    />
  );

  if (entries.length === 0) {
    return (
      <>
        {pipelineView}
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
      </>
    );
  }

  const row = (g: QueueGroup) => (
    <QueueRow
      key={g.id}
      group={g}
      selected={g.id === selectedGroup?.id}
      onSelect={() => select(g.lead.key)}
      check={checkFor(g.lead)}
      blockedReason={blockedFor(g.lead)}
    />
  );

  return (
    <>
      {pipelineView}
      <div className="-mx-4 grid grid-cols-[minmax(0,1fr)] items-start glass max-lg:[backdrop-filter:none] overflow-clip border-x-0 sm:mx-0 sm:rounded-[22px] sm:border-x lg:grid-cols-[380px_minmax(0,1fr)] lg:items-stretch">
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
            {TABS.filter((f) => f.id === "all" || f.id === "ready" || (counts[f.id] ?? 0) > 0 || filter === f.id).map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                data-testid={`queue-tab-${f.id}`}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "relative h-10 shrink-0 text-[13px] transition-colors duration-150 focus-visible:outline-offset-[-2px]",
                  filter === f.id ? "text-fg-1" : "text-fg-3 hover:text-fg-2",
                )}
              >
                {f.label}
                <span className="num ml-1.5 text-fg-3">{counts[f.id] ?? 0}</span>
                <span aria-hidden className={cn("absolute inset-x-0 -bottom-px h-0.5 bg-blue-500 transition-opacity duration-150", filter === f.id ? "opacity-100" : "opacity-0")} />
              </button>
            ))}
          </div>
          <QueueToolbar
            entries={data.entries}
            pendingNotices={data.pendingNotices}
            readySelectable={filter === "ready" ? readySelectable : null}
            onSelectReady={(keys) => setChecked(new Set(keys))}
            onComposed={(r) => setServerBlocked((prev) => ({ ...prev, ...r }))}
          />
          <SendAllApproved entries={data.entries} env={data.env} onFailed={(r) => setServerBlocked((prev) => ({ ...prev, ...r }))} />
          {stateFilter ? (
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-fg-2" data-testid="queue-state-filter">
              <span>
                Only <span className="text-fg-1">{stateFilter}</span>
              </span>
              <button type="button" onClick={() => setStateFilter(null)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-fg-2 hover:bg-ink-3 hover:text-fg-1">
                <X className="size-3.5" strokeWidth={1.5} aria-hidden /> Show all states
              </button>
            </div>
          ) : null}
          {statusFilter ? (
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs text-fg-2">
              <span>
                Outreach with status <span className="text-fg-1">{statusFilter.replace(/_/g, " ")}</span>
              </span>
              <button type="button" onClick={() => setStatusFilter(null)} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-fg-2 hover:bg-ink-3 hover:text-fg-1">
                <X className="size-3.5" strokeWidth={1.5} aria-hidden /> Clear
              </button>
            </div>
          ) : null}
          <div className={cn("pb-2 lg:min-h-0 lg:flex-1", checked.size > 0 && "max-lg:pb-16")}>
            {groups.length === 0 ? (
              <EmptyState
                title={filter === "ready" ? "Nothing is ready to approve" : "Nothing in this filter"}
                description={filter === "ready" ? "A draft is ready once it is composed and passes its checks. Compose all to check every queued draft at once." : "Everything of this kind has been handled."}
                className="px-4"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setFilter("all");
                      setStatusFilter(null);
                      setStateFilter(null);
                    }}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                  >
                    Show the full queue
                  </button>
                }
              />
            ) : null}
            {todo.length > 0 ? (
              <ul className="divide-y divide-line" aria-label="Awaiting you">
                {todo.map(row)}
              </ul>
            ) : null}
            {done.length > 0 ? (
              <>
                <h3 className="border-t border-line px-4 pt-4 pb-1.5 text-xs text-fg-3">Recently handled</h3>
                <ul className="divide-y divide-line" aria-label="Recently handled">
                  {done.map(row)}
                </ul>
              </>
            ) : null}
          </div>
          {/* lg: sticky footer of the list pane. Below lg the bar is pinned to the viewport bottom instead; that needs the glass panel to have no backdrop-filter there, because a filter makes the panel the containing block of fixed children. */}
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
              onBlocked={(r) => setServerBlocked((prev) => ({ ...prev, ...r }))}
            />
          </div>
        </div>

        <div ref={detailRef} className={cn("min-w-0 bg-ink-0/45", !mobileDetail && "max-lg:hidden")}>
          <button
            type="button"
            onClick={() => setMobileDetail(false)}
            className="flex h-11 w-full items-center gap-2 border-b border-line px-4 text-[13px] text-fg-2 hover:text-fg-1 lg:hidden"
          >
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden /> Back to queue
          </button>
          {selected ? (
            <div key={selected.key} data-testid="approval-detail" data-group={groupIdOf(selected)} className="es-detail-in" style={{ ["--es-from-y" as string]: `${travel * 8}px` }}>
              {selected.outreach ? (
                <OutreachDetail entry={selected} group={selectedFull} env={data.env} onSelectKey={(k) => select(k, { fromUser: false })} actionsRef={actionsRef} />
              ) : selected.report ? (
                <ReportDetail entry={selected} />
              ) : selected.claim ? (
                <ClaimDetail entry={selected} />
              ) : selected.ownerTask ? (
                <OwnerTaskDetail entry={selected} />
              ) : (
                <RuleDetail entry={selected} />
              )}
            </div>
          ) : (
            <EmptyState title="Select an item" description="Pick something from the queue to see exactly what will happen." className="p-6" />
          )}
        </div>
      </div>
    </>
  );
}
