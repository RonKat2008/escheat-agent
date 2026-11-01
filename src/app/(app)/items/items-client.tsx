"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Dialog as DrawerPrimitive } from "@base-ui/react/dialog";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useQueryStates } from "nuqs";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { DateCell, EmptyState, Money, StatusPill, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { RowCheckbox } from "@/components/b/RowCheckbox";
import { Button } from "@/components/ui/button";
import { diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_LABEL, formatSpan, PROPERTY_TYPE_LABEL, relativeDays } from "@/lib/format";
import type { StaleItemRow } from "@/lib/queries";
import { rangeIds, withIds } from "@/lib/ui/selection";
import { cn } from "@/lib/utils";
import { BulkBar } from "./bulk-bar";
import { FilterBar, type FilterValues } from "./filters";
import { itemsParsers } from "./params";
import { activeSort, isSortableColumn, nextSort } from "./sort";

const SOON_DAYS = 30;

function DeadlineCell({ row, asOf }: { row: StaleItemRow; asOf: string }) {
  const nd = row.nextDeadline;
  if (!nd) {
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

function useColumns(asOf: string): ColumnDef<StaleItemRow>[] {
  return useMemo(
    () => [
      { id: SELECT_COLUMN_ID, header: "Select", enableSorting: false, cell: () => null, meta: { className: "w-10 !px-0 text-center" } },
      {
        id: "check",
        header: "Check",
        accessorFn: (r) => r.checkNumber ?? "",
        cell: ({ row }) => <span className="font-mono text-xs text-fg-3">{row.original.checkNumber ? `#${row.original.checkNumber}` : "None"}</span>,
        meta: { className: "hidden w-[84px] sm:table-cell" },
      },
      {
        id: "payee",
        header: "Payee",
        accessorFn: (r) => r.payeeName,
        // The payee name itself is rendered by the table body inside the row's open button (see OPEN_COLUMN_ID);
        // this cell is just the phone-width meta line under it.
        cell: ({ row }) => (
          <span className="mt-1 flex items-center gap-2 text-xs text-fg-3 sm:hidden">
            <span className="font-mono">{row.original.checkNumber ? `#${row.original.checkNumber}` : "No check #"}</span>
            <span>{row.original.ownerState ?? "State unknown"}</span>
            <StatusPill status={row.original.status} className="text-xs" />
          </span>
        ),
      },
      {
        id: "state",
        header: "State",
        accessorFn: (r) => r.ownerState ?? "",
        cell: ({ row }) => (row.original.ownerState ? <span className="text-fg-2">{row.original.ownerState}</span> : <span className="text-fg-3 italic">Unknown</span>),
        meta: { className: "hidden w-[60px] sm:table-cell" },
      },
      {
        id: "amount",
        header: "Amount",
        accessorFn: (r) => r.amount.cents,
        cell: ({ row }) => <Money cents={row.original.amount.cents} className="font-medium text-fg-1" />,
        meta: { className: "w-[108px] text-right", align: "right" },
      },
      {
        id: "type",
        header: "Type",
        accessorFn: (r) => r.propertyType,
        cell: ({ row }) => <span className="text-fg-2">{PROPERTY_TYPE_LABEL[row.original.propertyType]}</span>,
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "age",
        header: "Issued",
        accessorFn: (r) => r.ageDays,
        cell: ({ row }) => <span className="num text-fg-3">{formatSpan(row.original.ageDays)} ago</span>,
        meta: { className: "hidden w-[84px] xl:table-cell" },
      },
      {
        id: "deadline",
        header: "Next deadline",
        accessorFn: (r) => r.nextDeadline?.date ?? "9999-12-31",
        cell: ({ row }) => <DeadlineCell row={row.original} asOf={asOf} />,
        meta: { className: "hidden md:table-cell" },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusPill status={row.original.status} />,
        meta: { className: "hidden w-[150px] sm:table-cell" },
      },
    ],
    [asOf],
  );
}

interface ColMeta {
  className?: string;
  align?: "right";
}

const NO_FILTERS = { state: null, status: null, type: null, minAge: null, review: null, q: null } as const;

export function ItemsClient({
  rows,
  total,
  asOf,
  drawerItemId,
  drawer,
}: {
  rows: StaleItemRow[];
  total: number;
  asOf: string;
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
  const columns = useColumns(asOf);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 is not memoized by the React compiler; fine here
  const table = useReactTable({
    data: rows,
    columns,
    // Sorting lives in the URL and runs on the server (all matching rows, not just the loaded page), so the table never re-sorts.
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });
  const displayed = table.getRowModel().rows;
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
      } else if (e.key === "x" && !e.shiftKey && cur && idx >= 0) {
        e.preventDefault();
        toggleRow(cur, !checkedIds.has(cur), false);
      } else if (e.key === "Enter" && idx >= 0 && !el?.closest("button,a")) {
        e.preventDefault();
        open(ids[idx]!);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleRow only reads displayed ids, which are in deps
  }, [displayed, activeId, drawerItemId, open, checkedIds]);

  const filterCount = [params.state, params.status, params.type, params.minAge, params.review, params.q].filter(Boolean).length;
  const clearAll = () => {
    setSearch("");
    void setParams(NO_FILTERS);
  };
  const values: FilterValues = { state: params.state, status: params.status, type: params.type, minAge: params.minAge, review: params.review };

  return (
    <div data-pending={pending || undefined} className={cn("transition-opacity duration-150", pending && "opacity-70")}>
      <FilterBar
        search={search}
        onSearch={setSearch}
        values={values}
        // Filter chips only offer values from the same lists the URL parsers accept.
        onChange={(patch) => void setParams(patch as Partial<typeof params>)}
        onClear={clearAll}
        filterCount={filterCount}
      />

      <div ref={tableRef} className="-mx-4 sm:mx-0">
        <table className="w-full text-[13px]" aria-label="Stale items">
          <thead className="sticky top-12 z-10 bg-ink-0">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="shadow-[inset_0_-1px_0_var(--color-line)]">
                {hg.headers.map((h) => {
                  const meta = (h.column.columnDef.meta ?? {}) as ColMeta;
                  const dir = sortNow?.columnId === h.column.id ? sortNow.dir : false;
                  if (h.column.id === SELECT_COLUMN_ID) {
                    return (
                      <th key={h.id} scope="col" className={cn("h-9 text-left", meta.className)}>
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
                      key={h.id}
                      scope="col"
                      aria-sort={!isSortableColumn(h.column.id) ? undefined : dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                      className={cn("h-9 px-4 text-left text-xs font-normal whitespace-nowrap text-fg-3 sm:px-3 sm:first:pl-3", meta.className)}
                    >
                      {isSortableColumn(h.column.id) ? (
                      <button
                        type="button"
                        onClick={() => void setParams({ sort: nextSort(h.column.id, params.sort) })}
                        className={cn("group/sort inline-flex items-center gap-1 rounded-sm transition-colors duration-150 hover:text-fg-1", dir && "text-fg-1", meta.align === "right" && "flex-row-reverse")}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : dir === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-50" aria-hidden />
                        )}
                      </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {displayed.map((row) => {
              const selected = row.id === drawerItemId || row.id === activeId;
              const isChecked = checkedIds.has(row.id);
              return (
                <tr
                  key={row.id}
                  data-row-id={row.id}
                  data-selected={selected || undefined}
                  data-checked={isChecked || undefined}
                  onClick={() => {
                    setActiveId(row.id);
                    open(row.id);
                  }}
                  className="cursor-pointer border-b border-line hover:bg-ink-2 sm:h-10"
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as ColMeta;
                    return (
                      <td key={cell.id} className={cn("px-4 py-2.5 align-middle sm:px-3 sm:py-1.5", meta.className)}>
                        {cell.column.id === SELECT_COLUMN_ID ? (
                          <RowCheckbox
                            className="mx-auto"
                            label={`Select ${row.original.payeeName}, check ${row.original.checkNumber ? `#${row.original.checkNumber}` : "None"}`}
                            checked={isChecked}
                            onToggle={(c, shift) => toggleRow(row.id, c, shift)}
                            data-testid="row-select"
                          />
                        ) : cell.column.id === OPEN_COLUMN_ID ? (
                          <>
                            {/* Only the visible name is inside the button, so its accessible name contains its visible text (WCAG 2.5.3). */}
                            <button
                              type="button"
                              aria-label={`Open ${row.original.payeeName}, check ${row.original.checkNumber ? `#${row.original.checkNumber}` : "None"}`}
                              className="block max-w-[180px] truncate rounded-sm text-left font-medium text-fg-1 xl:max-w-[260px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveId(row.id);
                                open(row.id);
                              }}
                            >
                              {row.original.payeeName}
                            </button>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayed.length === 0 ? (
          <EmptyState
            className="px-4 sm:px-3"
            title="No items match these filters"
            description={params.review ? "Nothing is flagged for review. Items land here when their classification confidence is low or no rule covers them yet." : "Clear a filter or widen the age range."}
            action={
              filterCount > 0 ? (
                <Button size="sm" variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <div className="sticky bottom-0 z-10">
        <BulkBar
          rows={selectedRows}
          onClear={() => setCheckedIds(new Set())}
          onDrafted={(ids) => setCheckedIds((prev) => withIds(prev, ids, false))}
        />
        <div className="flex items-center justify-between gap-3 border-t border-line bg-ink-0/90 px-4 py-2.5 text-[13px] text-fg-3 backdrop-blur-md sm:px-3">
          <span data-testid="items-footer">
            <span className="num text-fg-1">{total}</span> {total === 1 ? "item" : "items"}, <Money cents={totalCents} className="text-fg-1" /> as of {asOf}
          </span>
          <span className="hidden sm:inline">{filterCount > 0 ? "Filtered" : "All open items"}</span>
        </div>
        </div>
      </div>

      <DrawerPrimitive.Root
        open={drawerItemId !== null || params.item !== null}
        onOpenChange={(o) => {
          if (!o) {
            setActiveId(null);
            open(null);
          }
        }}
        modal={false}
        disablePointerDismissal
      >
        <DrawerPrimitive.Portal>
          {/* Below lg the drawer covers the table, so dim it and let a tap outside close it. Wide screens stay scrim-free. */}
          <div
            aria-hidden
            data-testid="item-drawer-scrim"
            onClick={() => {
              setActiveId(null);
              open(null);
            }}
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          />
          <DrawerPrimitive.Popup
            initialFocus={() => window.matchMedia("(max-width: 1023px)").matches}
            data-testid="item-drawer"
            aria-label="Item details"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-hover bg-ink-1 text-sm shadow-[var(--shadow-overlay)] outline-none transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-full data-ending-style:duration-200 data-ending-style:ease-[cubic-bezier(0.65,0,0.35,1)] data-starting-style:translate-x-full sm:w-[480px]"
          >
            <DrawerPrimitive.Title className="sr-only">Item details</DrawerPrimitive.Title>
            <DrawerPrimitive.Close
              aria-label="Close item details"
              className="absolute top-3.5 right-3.5 z-10 grid size-8 place-items-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-ink-3 hover:text-fg-1"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </DrawerPrimitive.Close>
            <div className="relative min-h-0 flex-1 overflow-y-auto">{drawer}</div>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </div>
  );
}
