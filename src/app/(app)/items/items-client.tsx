"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useQueryStates } from "nuqs";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DateCell, EmptyState, Money, StatusPill, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { RowCheckbox } from "@/components/b/RowCheckbox";
import { Button } from "@/components/ui/button";
import { diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_LABEL, formatDate, formatSpan, PROPERTY_TYPE_LABEL, relativeDays } from "@/lib/format";
import type { OverdueFlag, StaleItemRow } from "@/lib/queries";
import { lateLabel, OBLIGATION_LABEL, overdueShort } from "@/lib/overdue";
import { rangeIds, withIds } from "@/lib/ui/selection";
import { cn } from "@/lib/utils";
import { MotionMax } from "@/components/motion/MotionRoot";
import { BulkBar, useBulkDraft } from "./bulk-bar";
import { SavedViews } from "./saved-views";
import { StateRibbon } from "./state-ribbon";
import type { RibbonSegment, SavedViewId } from "./view-model";
import { FilterBar, type FilterValues } from "./filters";
import { itemsParsers } from "./params";
import { activeSort, isSortableColumn, nextSort } from "./sort";

// The drawer (dialog primitive) is its own chunk: the table's first load does not pay for it until a row is opened.
const ItemDrawer = dynamic(() => import("./item-drawer"));

const SOON_DAYS = 30;

/** Pink "Overdue 4mo" chip: the earliest missed deadline from the shared overdue assessment. */
function OverdueChip({ flag }: { flag: Extract<OverdueFlag, { state: "overdue" }> }) {
  const e = flag.earliest;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap" title={`${OBLIGATION_LABEL[e.kind]} ${e.date}, ${lateLabel(e.daysLate)}`} data-testid="overdue-chip">
      <span className="inline-flex items-center rounded-sm bg-pink-900/50 px-1.5 py-0.5 text-xs font-medium text-pink-300 ring-1 ring-pink-500/50 ring-inset">
        {overdueShort(e.daysLate)}
      </span>
      <DateCell date={e.date} className="text-fg-2" />
      <span className="sr-only">{`${OBLIGATION_LABEL[e.kind]}, ${lateLabel(e.daysLate)}`}</span>
      {!flag.verified ? <UnverifiedBadge compact /> : null}
    </span>
  );
}

function DeadlineCell({ row, asOf, flag }: { row: StaleItemRow; asOf: string; flag: OverdueFlag | undefined }) {
  if (flag?.state === "overdue") return <OverdueChip flag={flag} />;
  const nd = row.nextDeadline;
  if (!nd) {
    if (flag?.state === "date_unknown") return <UnknownBadge label="Date unknown" />;
    return row.status === "needs_rule" || !row.ownerState ? <UnknownBadge /> : <span className="text-fg-3 italic">None left</span>;
  }
  const days = diffDays(asOf as IsoDate, nd.date as IsoDate);
  const soon = days <= SOON_DAYS;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap" title={DEADLINE_LABEL[nd.kind]}>
      <DateCell date={nd.date} className={soon ? "text-fg-1" : "text-fg-2"} />
      <span className={cn("text-xs", soon ? "font-medium text-pink-400" : "text-fg-3")}>{relativeDays(days)}</span>
      {!nd.verified ? <UnverifiedBadge compact /> : null}
    </span>
  );
}

/**
 * The column that carries the row's keyboard-reachable open button. It must be visible at every width: the Check
 * column is `hidden` below `sm`, which used to leave phone-width keyboard users with no focusable control.
 */
const OPEN_COLUMN_ID = "payee";
const SELECT_COLUMN_ID = "select";

/** One table column. Rows are server-sorted and server-filtered, so a column is just a header and a cell renderer. */
interface Column {
  id: string;
  header: string;
  cell: (row: StaleItemRow) => ReactNode;
  meta?: ColMeta;
}

function useColumns(asOf: string, overdue: Record<string, OverdueFlag>): Column[] {
  return useMemo(
    () => [
      { id: SELECT_COLUMN_ID, header: "Select", cell: () => null, meta: { className: "w-10 !px-0 text-center" } },
      {
        id: "check",
        header: "Check",
        cell: (r) => <span className="font-mono text-xs text-fg-3">{r.checkNumber ? `#${r.checkNumber}` : "None"}</span>,
        // Below xl the check number moves under the payee name (see the payee cell): at 1024 the table must fit the main column.
        meta: { className: "hidden w-[84px] xl:table-cell" },
      },
      {
        id: "payee",
        header: "Payee",
        // The payee name itself is rendered by the table body inside the row's open button (see OPEN_COLUMN_ID);
        // this cell is just the phone-width meta line under it.
        cell: (r) => (
          <>
            <span className="mt-1 flex items-center gap-2 text-xs text-fg-3 sm:hidden">
              <span className="font-mono">{r.checkNumber ? `#${r.checkNumber}` : "No check #"}</span>
              <span>{r.ownerState ?? "State unknown"}</span>
              <StatusPill status={r.status} className="text-xs" />
            </span>
            {/* R3-19: below md the Next deadline column is hidden, so every row carries its deadline here. */}
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs md:hidden" data-testid="row-deadline-phone">
              <span className="text-fg-3">Next</span>
              <DeadlineCell row={r} asOf={asOf} flag={overdue[r.id]} />
            </span>
            <span className="mt-0.5 hidden font-mono text-xs text-fg-3 sm:block xl:hidden">{r.checkNumber ? `#${r.checkNumber}` : "No check #"}</span>
          </>
        ),
      },
      {
        id: "state",
        header: "State",
        cell: (r) => (r.ownerState ? <span className="text-fg-2">{r.ownerState}</span> : <span className="text-fg-3 italic">Unknown</span>),
        meta: { className: "hidden w-[60px] sm:table-cell" },
      },
      {
        id: "amount",
        header: "Amount",
        cell: (r) => <Money cents={r.amount.cents} className="font-medium text-fg-1" />,
        meta: { className: "w-[108px] text-right", align: "right" },
      },
      {
        id: "type",
        header: "Type",
        cell: (r) => <span className="text-fg-2">{PROPERTY_TYPE_LABEL[r.propertyType]}</span>,
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "age",
        header: "Issued",
        cell: (r) => <span className="num text-fg-3">{formatSpan(r.ageDays)} ago</span>,
        meta: { className: "hidden w-[84px] xl:table-cell" },
      },
      {
        id: "deadline",
        header: "Next deadline",
        cell: (r) => <DeadlineCell row={r} asOf={asOf} flag={overdue[r.id]} />,
        meta: { className: "hidden md:table-cell" },
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => <StatusPill status={r.status} />,
        meta: { className: "hidden w-[150px] sm:table-cell" },
      },
    ],
    [asOf, overdue],
  );
}

interface ColMeta {
  className?: string;
  align?: "right";
}

const NO_FILTERS = { state: null, status: null, type: null, minAge: null, review: null, overdue: null, q: null, view: null } as const;

export function ItemsClient({
  rows,
  total,
  asOf,
  drawerItemId,
  drawer,
  overdue,
  overdueCount,
  viewCounts,
  ribbon,
}: {
  viewCounts: Record<SavedViewId, number>;
  ribbon: RibbonSegment[];
  rows: StaleItemRow[];
  total: number;
  asOf: string;
  overdue: Record<string, OverdueFlag>;
  overdueCount: number;
  drawerItemId: string | null;
  drawer: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(itemsParsers, { shallow: false, startTransition, clearOnDefault: true });
  const [search, setSearch] = useState(params.q ?? "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const drawerWanted = drawerItemId !== null || params.item !== null;
  const [drawerWantedAtFirstRender] = useState(drawerWanted);
  // Once opened the drawer stays mounted (closed), so its exit transition still plays.
  const [drawerArmed, setDrawerArmed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch: keep the drawer mounted after its first open
    if (drawerWanted) setDrawerArmed(true);
  }, [drawerWanted]);
  // The row the drawer was last showing, so closing it can put focus back on that row's open button.
  const lastRowId = useRef<string | null>(null);
  useEffect(() => {
    if (drawerItemId) lastRowId.current = drawerItemId;
  }, [drawerItemId]);
  const columns = useColumns(asOf, overdue);

  // Sorting lives in the URL and runs on the server (all matching rows, not just the loaded page), so the table never re-sorts.
  const displayed = rows;
  const sortNow = activeSort(params.sort);
  const totalCents = rows.reduce((a, r) => a + r.amount.cents, 0);
  const displayedIds = displayed.map((r) => r.id);
  // Only rows still in the (server-filtered) list count, so the bar never reports items you can no longer see.
  const selectedRows = rows.filter((r) => checkedIds.has(r.id));
  const allSelected = displayedIds.length > 0 && displayedIds.every((id) => checkedIds.has(id));

  const toggleRow = (id: string, checked: boolean, shift: boolean) => {
    const ids = shift ? rangeIds(displayedIds, anchorRef.current, id) : [id];
    setCheckedIds((prev) => withIds(prev, ids, checked));
    anchorRef.current = id;
  };
  const toggleAll = (checked: boolean) => setCheckedIds((prev) => withIds(prev, displayedIds, checked));
  const bulk = useBulkDraft({ onDrafted: (ids) => setCheckedIds((prev) => withIds(prev, ids, false)) });

  // debounce the search box into the URL
  useEffect(() => {
    if ((params.q ?? "") === search.trim()) return;
    const t = setTimeout(() => void setParams({ q: search.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [search, params.q, setParams]);

  const open = useCallback((id: string | null) => void setParams({ item: id }), [setParams]);

  // j/k/enter row navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const isCheckbox = el instanceof HTMLInputElement && el.type === "checkbox";
      if (el && !isCheckbox && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = displayed.map((r) => r.id);
      if (ids.length === 0) return;
      const cur = activeId ?? drawerItemId;
      const idx = cur ? ids.indexOf(cur) : -1;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = ids[Math.max(0, Math.min(ids.length - 1, idx + (e.key === "j" ? 1 : -1)))]!;
        setActiveId(next);
        if (drawerItemId) open(next);
        tableRef.current?.querySelector(`[data-row-id="${next}"]`)?.scrollIntoView({ block: "nearest" });
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.shiftKey) {
        // Extend the checked selection from the active row, one row at a time.
        e.preventDefault();
        const from = idx >= 0 ? idx : 0;
        const to = Math.max(0, Math.min(ids.length - 1, idx < 0 ? 0 : from + (e.key === "ArrowDown" ? 1 : -1)));
        const extend = [ids[from]!, ids[to]!];
        setCheckedIds((prev) => withIds(prev, extend, true));
        anchorRef.current = ids[to]!;
        setActiveId(ids[to]!);
        tableRef.current?.querySelector(`[data-row-id="${ids[to]}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "d" && !e.shiftKey) {
        // Draft for the checked rows, or the active row when nothing is checked. Always opens the dry-run preview first.
        const target = checkedIds.size > 0 ? rows.filter((r) => checkedIds.has(r.id)) : rows.filter((r) => r.id === cur);
        if (target.length === 0) return;
        e.preventDefault();
        bulk.start(target);
      } else if (e.key === "/" && !drawerItemId) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-testid=items-search]")?.focus();
      } else if (e.key === "Escape" && !drawerItemId && checkedIds.size > 0) {
        setCheckedIds(new Set());
      } else if (e.key === "x" && !e.shiftKey && cur && idx >= 0) {
        e.preventDefault();
        toggleRow(cur, !checkedIds.has(cur), false);
      } else if (e.key === "Enter" && idx >= 0 && !el?.closest("button,a,summary")) {
        e.preventDefault();
        open(ids[idx]!);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleRow only reads displayed ids, which are in deps
  }, [displayed, activeId, drawerItemId, open, checkedIds, rows, bulk]);

  const filterCount = [params.state, params.status, params.type, params.minAge, params.review, params.overdue, params.q].filter(Boolean).length;
  const clearAll = () => {
    setSearch("");
    void setParams(NO_FILTERS);
  };
  const values: FilterValues = { state: params.state, status: params.status, type: params.type, minAge: params.minAge, review: params.review, overdue: params.overdue };

  return (
    <MotionMax>
    <div data-pending={pending || undefined} className={cn("transition-opacity duration-150", pending && "opacity-70")}>
      <SavedViews value={params.view ?? "all"} counts={viewCounts} onChange={(v) => void setParams({ view: v === "all" ? null : v })} />
      <FilterBar
        search={search}
        onSearch={setSearch}
        values={values}
        // Filter chips only offer values from the same lists the URL parsers accept.
        onChange={(patch) => void setParams(patch as Partial<typeof params>)}
        onClear={clearAll}
        filterCount={filterCount}
        overdueCount={overdueCount}
      />
      <StateRibbon segments={ribbon} active={params.state} onPick={(st) => void setParams({ state: st })} />

      <div ref={tableRef} className="relative -mx-4 sm:mx-0">
        {/* Busy hairline while a filter or sort round-trips. Absolutely placed, so it never moves the table. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden">
          {pending ? <div className="es-busy h-full bg-blue-500" data-testid="items-busy" /> : null}
        </div>
        <table className="w-full text-[13px]" aria-label="Stale items">
          <thead className="sticky top-12 z-10 bg-ink-0">
            <tr className="shadow-[inset_0_-1px_0_var(--color-line)]">
              {columns.map((col) => {
                const meta = col.meta ?? {};
                const dir = sortNow?.columnId === col.id ? sortNow.dir : false;
                if (col.id === SELECT_COLUMN_ID) {
                  return (
                    <th key={col.id} scope="col" className={cn("h-9 text-left", meta.className)}>
                      <RowCheckbox
                        className="mx-auto"
                        label={allSelected ? "Deselect all filtered items" : "Select all filtered items"}
                        checked={allSelected}
                        indeterminate={selectedRows.length > 0}
                        disabled={displayedIds.length === 0}
                        onToggle={(c) => toggleAll(c)}
                        data-testid="select-all"
                      />
                    </th>
                  );
                }
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={!isSortableColumn(col.id) ? undefined : dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    className={cn("h-9 px-4 text-left text-xs font-normal whitespace-nowrap text-fg-3 sm:px-3 sm:first:pl-3", meta.className)}
                  >
                    {isSortableColumn(col.id) ? (
                      <button
                        type="button"
                        onClick={() => void setParams({ sort: nextSort(col.id, params.sort) })}
                        className={cn("group/sort inline-flex items-center gap-1 rounded-sm transition-colors duration-150 hover:text-fg-1", dir && "text-fg-1", meta.align === "right" && "flex-row-reverse")}
                      >
                        {col.header}
                        {dir === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : dir === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayed.map((r) => {
              const selected = r.id === drawerItemId || r.id === activeId;
              const isChecked = checkedIds.has(r.id);
              return (
                <tr
                  key={r.id}
                  data-row-id={r.id}
                  data-selected={selected || undefined}
                  data-checked={isChecked || undefined}
                  onClick={() => {
                    setActiveId(r.id);
                    open(r.id);
                  }}
                  className="group/row cursor-pointer border-b border-line transition-[background-color] duration-100 hover:bg-ink-2 sm:h-10"
                >
                  {columns.map((col) => {
                    const meta = col.meta ?? {};
                    return (
                      <td key={col.id} className={cn("px-4 py-2.5 align-middle sm:px-3 sm:py-1.5", meta.className)}>
                        {col.id === SELECT_COLUMN_ID ? (
                          <RowCheckbox
                            className="mx-auto"
                            label={`Select ${r.payeeName}, check ${r.checkNumber ? `#${r.checkNumber}` : "None"}`}
                            checked={isChecked}
                            onToggle={(c, shift) => toggleRow(r.id, c, shift)}
                            data-testid="row-select"
                          />
                        ) : col.id === OPEN_COLUMN_ID ? (
                          <>
                            {/* Only the visible name is inside the button, so its accessible name contains its visible text (WCAG 2.5.3). */}
                            <button
                              type="button"
                              aria-label={`Open ${r.payeeName}, check ${r.checkNumber ? `#${r.checkNumber}` : "None"}`}
                              title={r.payeeName}
                              className="block max-w-full rounded-sm text-left font-medium break-words text-fg-1 sm:max-w-[180px] sm:truncate xl:max-w-[260px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveId(r.id);
                                open(r.id);
                              }}
                            >
                              {r.payeeName}
                            </button>
                            {col.cell(r)}
                          </>
                        ) : (
                          col.cell(r)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {displayed.length > 0 ? (
            <tfoot data-testid="items-total-row">
              <tr className="border-t border-line-strong">
                {columns.map((col) => {
                  const meta = col.meta ?? {};
                  const base = cn("px-4 py-2.5 align-middle sm:px-3", meta.className);
                  if (col.id === OPEN_COLUMN_ID) {
                    return (
                      <th key={col.id} scope="row" className={cn(base, "text-left text-xs font-normal text-fg-3")}>
                        Total, <span className="num">{displayed.length}</span> {displayed.length === 1 ? "item" : "items"}
                        {displayed.length < total ? <span> of {total}</span> : null}
                      </th>
                    );
                  }
                  if (col.id === "amount") {
                    return (
                      <td key={col.id} className={base}>
                        <Money cents={totalCents} className="font-medium text-fg-1" />
                      </td>
                    );
                  }
                  return <td key={col.id} className={base} />;
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {displayed.length === 0 ? (
          <EmptyState
            className="px-4 sm:px-3"
            title="No items match these filters"
            description={params.overdue ? "Nothing here is past a report, remittance or due-diligence deadline as of the demo date." : params.review ? "Nothing is flagged for review. Items land here when their classification confidence is low or no rule covers them yet." : "Clear a filter or widen the age range."}
            action={
              filterCount > 0 ? (
                <Button size="sm" variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <div className="sticky bottom-0 z-20 sm:bottom-10">
          <BulkBar rows={selectedRows} busy={bulk.busy} onClear={() => setCheckedIds(new Set())} onDraft={() => bulk.start(selectedRows)} />
        </div>
        {/* R3-19: the footer sum is sticky from sm up (opaque, so rows never show through) and in flow on phones, where
            a sticky bar would sit on top of the last visible row. */}
        <div className="z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line bg-ink-1 px-4 py-2.5 text-[13px] text-fg-3 sm:sticky sm:bottom-0 sm:h-10 sm:flex-nowrap sm:px-3 sm:py-0" data-testid="items-footer-bar">
          <span data-testid="items-footer">
            <span className="num text-fg-1">{total}</span> {total === 1 ? "item" : "items"}, <Money cents={totalCents} className="text-fg-1" /> as of <time dateTime={asOf}>{formatDate(asOf)}</time>
          </span>
          <span className="hidden sm:inline">{filterCount > 0 || params.view ? "Filtered" : "All open items"}</span>
        </div>
      </div>
      {bulk.dialogs}

      {drawerWanted || drawerArmed ? (
        <ItemDrawer
          open={drawerWanted}
          lateMount={!drawerWantedAtFirstRender}
          onClose={() => {
            setActiveId(null);
            open(null);
          }}
          getFinalFocus={() => tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${lastRowId.current}"] button[aria-label^="Open "]`) ?? null}
        >
          {drawer}
        </ItemDrawer>
      ) : null}
    </div>
    </MotionMax>
  );
}
