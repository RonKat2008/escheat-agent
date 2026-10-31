"use client";

import { Fragment, useId, useState, useTransition } from "react";
import { m } from "motion/react";
import { ArrowDown, ArrowUp, ChevronRight, ListChecks, Search, X } from "lucide-react";
import { loadItemTimeline, type ItemTimelineResult } from "@/app/(app)/chat/actions";
import { DateCell, Money } from "@/components/primitives";
import type { ItemsUi } from "@/lib/chat/ui-types";
import type { StaleItemRow } from "@/lib/queries/schemas";
import { cn } from "@/lib/utils";
import { filterItems, nextSort, sortItems, statusCounts, type SortKey, type SortState } from "./items-table";
import { AskButton, AttentionNote, fmtDate, FooterLink, STATUS_LABEL, StatusTag, UnverifiedFlag, ViewCard } from "./parts";
import { LegalTimeline } from "./Timeline";

const COLLAPSED_ROWS = 8;
/** Filters only earn their space once the table is long enough to need them. */
const FILTER_MIN_ROWS = 6;

function itemsHref(filters: ItemsUi["props"]["filters"]): string {
  const q = new URLSearchParams();
  if (typeof filters.state === "string") q.set("state", filters.state);
  if (typeof filters.status === "string") q.set("status", filters.status);
  if (typeof filters.search === "string") q.set("q", filters.search);
  const s = q.toString();
  return s ? `/items?${s}` : "/items";
}

interface SortHeaderProps {
  k: SortKey;
  label: string;
  sort: SortState;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}

function SortHeader({ k, label, sort, onSort, align = "left", className }: SortHeaderProps) {
  const active = sort.key === k;
  const Icon = active && sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("px-2 py-2 font-normal", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "chat-focus group/sort inline-flex min-h-7 items-center gap-1 rounded-[4px] transition-colors duration-150 hover:text-[var(--chat-t1)]",
          align === "right" && "flex-row-reverse",
          active && "text-[var(--chat-t1)]",
        )}
      >
        {label}
        <Icon className={cn("size-3 transition-opacity duration-150", active ? "opacity-100" : "opacity-0 group-hover/sort:opacity-50")} aria-hidden />
      </button>
    </th>
  );
}

function Deadline({ item }: { item: StaleItemRow }) {
  if (!item.nextDeadline) return <span className="text-[var(--chat-t3)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <DateCell date={item.nextDeadline.date} />
      {item.nextDeadline.verified ? null : <UnverifiedFlag compact />}
    </span>
  );
}

type Loaded = ItemTimelineResult | "loading";

/** The inline timeline under an expanded row: same engine output as the Items drawer, loaded on demand. */
function ExpandedRow({ item, state, colSpan }: { item: StaleItemRow; state: Loaded | undefined; colSpan: number }) {
  const ref = item.checkNumber ? `#${item.checkNumber}` : null;
  return (
    <tr className="border-b border-[var(--chat-line)] bg-[var(--chat-ink-0)]/60" data-testid="items-row-detail">
      <td colSpan={colSpan} className="px-4 pt-3 pb-4">
        {/* w-0 + min-w-full: the detail never widens the table, it takes the width the columns already have. */}
        <m.div className="w-0 min-w-full" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
          {state === "loading" || state === undefined ? (
            <div className="space-y-3 py-1" aria-busy="true" aria-label="Loading timeline">
              {[0, 1, 2].map((i) => (
                <div key={i} className="chat-pulse h-4 rounded bg-[var(--chat-ink-3)]" style={{ width: `${70 - i * 15}%` }} />
              ))}
            </div>
          ) : state.ok ? (
            <>
              <LegalTimeline explanation={state.explanation} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ref ? <AskButton question={`Explain check ${ref}`}>Ask about {ref}</AskButton> : null}
                <span className="flex-1" />
                <FooterLink href={`/items?item=${encodeURIComponent(item.checkNumber ?? item.id)}`}>Open in Items</FooterLink>
              </div>
            </>
          ) : (
            <AttentionNote>{state.error}</AttentionNote>
          )}
        </m.div>
      </td>
    </tr>
  );
}

export function ItemsTableView({ asOf, total, items, filters }: ItemsUi["props"]) {
  const [sort, setSort] = useState<SortState>({ key: "amount", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, Loaded>>({});
  const [, startTransition] = useTransition();
  const searchId = useId();

  const visible = sortItems(filterItems(items, { query, status }), sort);
  const filtering = query.trim() !== "" || status !== null;
  const shown = showAll || filtering ? visible : visible.slice(0, COLLAPSED_ROWS);
  const statuses = statusCounts(items);
  const oneState = new Set(items.map((i) => i.ownerState)).size <= 1;
  const colSpan = oneState ? 4 : 5;
  const label = Object.entries(filters)
    .filter(([k]) => k !== "limit" && k !== "sort")
    .map(([k, v]) => (k === "min_amount_dollars" ? `over $${Number(v).toLocaleString("en-US")}` : k === "state" ? String(v) : `${k.replaceAll("_", " ")}: ${String(v)}`))
    .join(", ");

  function toggle(item: StaleItemRow) {
    const next = open === item.id ? null : item.id;
    setOpen(next);
    if (!next || timelines[item.id]) return;
    setTimelines((t) => ({ ...t, [item.id]: "loading" }));
    startTransition(async () => {
      const r = await loadItemTimeline(item.id).catch((): ItemTimelineResult => ({ ok: false, error: "Could not load the timeline. Open it in Items instead." }));
      setTimelines((t) => ({ ...t, [item.id]: r }));
    });
  }

  return (
    <ViewCard
      testId="view-items"
      icon={<ListChecks />}
      title={label ? `Stale items, ${label}` : "Stale items"}
      meta={`${total} ${total === 1 ? "item" : "items"}, as of ${fmtDate(asOf)}`}
      footer={
        <>
          {!filtering && visible.length > COLLAPSED_ROWS ? (
            <button
              type="button"
              onClick={() => setShowAll((e) => !e)}
              className="chat-focus h-8 rounded-md px-2 text-[13px] text-[var(--chat-t2)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
            >
              {showAll ? "Show fewer" : `Show all ${visible.length}`}
            </button>
          ) : null}
          {total > items.length ? <span className="text-xs text-[var(--chat-t3)] tabular-nums">{items.length} of {total} loaded</span> : null}
          <span className="flex-1" />
          <FooterLink href={itemsHref(filters)}>Open in Items</FooterLink>
        </>
      }
    >
      {items.length >= FILTER_MIN_ROWS ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--chat-line)] px-4 py-2.5" data-testid="items-filters">
          <label htmlFor={searchId} className="sr-only">
            Filter by payee or check number
          </label>
          <span className="relative min-w-0 flex-1 basis-40">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--chat-t3)]" strokeWidth={1.5} aria-hidden />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Payee or check #"
              data-testid="items-search"
              className="h-8 w-full rounded-md border border-[var(--chat-line-strong)] bg-[var(--chat-ink-0)] pr-2.5 pl-8 text-[13px] text-[var(--chat-t1)] outline-none transition-[border-color] duration-150 placeholder:text-[var(--chat-t3)] focus-visible:border-[var(--chat-blue-text)] [&::-webkit-search-cancel-button]:hidden"
            />
          </span>
          {statuses.length > 1 ? (
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {statuses.map((s) => {
                const on = status === s.status;
                return (
                  <button
                    key={s.status}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStatus(on ? null : s.status)}
                    className={cn(
                      "chat-focus inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-[background-color,border-color,color] duration-150",
                      on
                        ? "border-[var(--chat-blue-500)]/60 bg-[var(--chat-blue-900)] text-[var(--chat-t1)]"
                        : "border-[var(--chat-line-strong)] text-[var(--chat-t2)] hover:border-[var(--chat-blue-text)]/40 hover:text-[var(--chat-t1)]",
                    )}
                  >
                    {STATUS_LABEL[s.status] ?? s.status.replaceAll("_", " ")}
                    <span className="text-[var(--chat-t3)] tabular-nums">{s.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatus(null);
              }}
              className="chat-focus inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-[var(--chat-t2)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
            >
              <X className="size-3.5" aria-hidden />
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--chat-t3)]">No items match.</p>
      ) : visible.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--chat-t3)]" role="status">
          No items match this filter.
        </p>
      ) : (
        <div className="chat-table-scroll relative overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-[var(--chat-t3)]">
              <tr className="border-b border-[var(--chat-line)]">
                <SortHeader k="payee" label="Payee" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} className="pl-4" />
                <SortHeader k="amount" label="Amount" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
                <SortHeader k="age" label="Age" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" className="hidden @lg:table-cell" />
                {oneState ? null : (
                  <th scope="col" className="hidden px-2 py-2 font-normal @lg:table-cell">
                    State
                  </th>
                )}
                <SortHeader k="deadline" label="Next deadline" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} className="hidden pr-4 @md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const expanded = open === i.id;
                return (
                  <Fragment key={i.id}>
                    <tr
                      className={cn(
                        "group cursor-pointer border-b border-[var(--chat-line)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)]",
                        expanded && "bg-[var(--chat-ink-2)]",
                      )}
                      onClick={() => toggle(i)}
                      data-testid="items-row"
                    >
                      <td className="relative max-w-[220px] py-2.5 pr-2 pl-4">
                        {expanded ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--chat-blue-500)]" /> : null}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(i);
                          }}
                          className="chat-focus flex max-w-full items-center gap-1.5 rounded-[4px] text-left text-[var(--chat-t1)]"
                        >
                          <ChevronRight
                            className={cn("size-3.5 shrink-0 text-[var(--chat-t3)] transition-transform duration-150", expanded && "rotate-90 text-[var(--chat-blue-text)]")}
                            strokeWidth={1.5}
                            aria-hidden
                          />
                          <span className="truncate">{i.payeeName}</span>
                          <span className="sr-only">{expanded ? ", hide timeline" : ", show timeline"}</span>
                        </button>
                        <span className="mt-0.5 flex items-center gap-2 pl-5 text-xs text-[var(--chat-t3)]">
                          <span className="font-mono">{i.checkNumber ? `#${i.checkNumber}` : "no ref"}</span>
                          <StatusTag status={i.status} />
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 pl-2 text-right align-top text-[var(--chat-t1)] tabular-nums @md:pr-2">
                        <Money cents={i.amount.cents} />
                        {/* Narrow cards (phone, side panel) fold the deadline under the amount instead of scrolling sideways. */}
                        <span className="mt-0.5 flex justify-end text-xs text-[var(--chat-t3)] @md:hidden">
                          <Deadline item={i} />
                        </span>
                      </td>
                      <td className="hidden px-2 py-2.5 text-right align-top text-[var(--chat-t2)] tabular-nums @lg:table-cell">{i.ageDays}d</td>
                      {oneState ? null : <td className="hidden px-2 py-2.5 align-top text-[var(--chat-t2)] @lg:table-cell">{i.ownerState ?? "—"}</td>}
                      <td className="hidden py-2.5 pr-4 pl-2 align-top text-[var(--chat-t2)] @md:table-cell">
                        <Deadline item={i} />
                      </td>
                    </tr>
                    {expanded ? <ExpandedRow item={i} state={timelines[i.id]} colSpan={colSpan} /> : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ViewCard>
  );
}
