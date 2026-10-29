"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Dialog as DrawerPrimitive } from "@base-ui/react/dialog";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useQueryStates } from "nuqs";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { DateCell, EmptyState, Money, StatusDot, StatusPill, UnknownBadge, UnverifiedBadge, STATUS_META } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_LABEL, formatSpan, PROPERTY_TYPE_LABEL, relativeDays } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import type { StaleItemRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { AGE_OPTIONS, itemsParsers } from "./params";

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-surface px-2 text-xs text-foreground transition-colors duration-150 hover:border-strong focus-visible:outline-2";

function useColumns(asOf: string): ColumnDef<StaleItemRow>[] {
  return useMemo(
    () => [
      {
        id: "check",
        header: "Check #",
        accessorFn: (r) => r.checkNumber ?? "",
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.checkNumber ? `#${row.original.checkNumber}` : "—"}</span>,
        meta: { className: "hidden w-[88px] sm:table-cell" },
      },
      {
        id: "payee",
        header: "Payee",
        accessorFn: (r) => r.payeeName,
        cell: ({ row }) => (
          <>
            <span className="block max-w-[190px] truncate font-medium xl:max-w-[260px]">{row.original.payeeName}</span>
            <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground sm:hidden">
              {row.original.checkNumber ? `#${row.original.checkNumber}` : "—"} · {row.original.ownerState ?? "?"}
              <StatusDot status={row.original.status} withLabel className="font-sans" />
            </span>
          </>
        ),
      },
      {
        id: "state",
        header: "State",
        accessorFn: (r) => r.ownerState ?? "",
        cell: ({ row }) =>
          row.original.ownerState ? (
            <span className="inline-block rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs">{row.original.ownerState}</span>
          ) : (
            <span className="text-muted-foreground italic">Unknown</span>
          ),
        meta: { className: "hidden w-[64px] sm:table-cell" },
      },
      {
        id: "amount",
        header: "Amount",
        accessorFn: (r) => r.amount.cents,
        cell: ({ row }) => <Money cents={row.original.amount.cents} className="text-[13px]" />,
        meta: { className: "text-right w-[112px]", align: "right" },
      },
      {
        id: "type",
        header: "Type",
        accessorFn: (r) => r.propertyType,
        cell: ({ row }) => <span className="text-muted-foreground">{PROPERTY_TYPE_LABEL[row.original.propertyType]}</span>,
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "age",
        header: "Issued",
        accessorFn: (r) => r.ageDays,
        cell: ({ row }) => <span className="font-mono text-[13px] text-muted-foreground">{formatSpan(row.original.ageDays)}</span>,
        meta: { className: "hidden xl:table-cell w-[72px]" },
      },
      {
        id: "deadline",
        header: "Next deadline",
        accessorFn: (r) => r.nextDeadline?.date ?? "9999-12-31",
        cell: ({ row }) => {
          const nd = row.original.nextDeadline;
          if (!nd) {
            return row.original.status === "needs_rule" || !row.original.ownerState ? (
              <UnknownBadge />
            ) : (
              <span className="text-muted-foreground italic">None left</span>
            );
          }
          const days = diffDays(asOf as IsoDate, nd.date as IsoDate);
          return (
            <span className="flex items-center gap-2 whitespace-nowrap" title={DEADLINE_LABEL[nd.kind]}>
              <DateCell date={nd.date} className={cn(days <= 30 && "text-at-risk")} />
              <span className={cn("font-mono text-xs", days <= 30 ? "text-at-risk" : "text-muted-foreground")}>{relativeDays(days)}</span>
              {!nd.verified ? <UnverifiedBadge compact /> : null}
            </span>
          );
        },
        meta: { className: "hidden sm:table-cell" },
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState(params.q ?? "");
  const [activeId, setActiveId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(asOf);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 is not memoized by the React compiler; fine here
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (r) => r.id,
  });
  const displayed = table.getRowModel().rows;
  const totalCents = rows.reduce((a, r) => a + r.amount.cents, 0);

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
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
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
      } else if (e.key === "Enter" && idx >= 0 && !el?.closest("button,a")) {
        e.preventDefault();
        open(ids[idx]!);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [displayed, activeId, drawerItemId, open]);

  const filterCount = [params.state, params.status, params.type, params.minAge, params.review, params.q].filter(Boolean).length;
  const states = ["CA", "DE", "TX"];
  const statusKeys = ["to_report", "dd_pending", "owner_responded", "dd_sent", "needs_rule", "watching", "reported", "resolved_paid", "remitted"];

  return (
    <div data-pending={pending || undefined} className={cn("transition-opacity duration-150", pending && "opacity-80")}>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="search" aria-label="Filter items">
        <label className="relative">
          <span className="sr-only">Search payee or check number</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payee or check #"
            className="h-8 w-56 rounded-lg border border-input bg-surface pr-2 pl-8 text-xs transition-colors duration-150 outline-none placeholder:text-muted-foreground hover:border-strong focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </label>
        <label>
          <span className="sr-only">State</span>
          <select className={SELECT_CLASS} value={params.state ?? ""} onChange={(e) => void setParams({ state: e.target.value || null })}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select className={SELECT_CLASS} value={params.status ?? ""} onChange={(e) => void setParams({ status: e.target.value || null })}>
            <option value="">All open statuses</option>
            {statusKeys.map((s) => (
              <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Type</span>
          <select className={SELECT_CLASS} value={params.type ?? ""} onChange={(e) => void setParams({ type: e.target.value || null })}>
            <option value="">All types</option>
            {Object.entries(PROPERTY_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Age</span>
          <select className={SELECT_CLASS} value={params.minAge ? String(params.minAge) : ""} onChange={(e) => void setParams({ minAge: e.target.value ? Number(e.target.value) : null })}>
            {AGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={Boolean(params.review)}
          onClick={() => void setParams({ review: params.review ? null : true })}
          className={cn(
            "h-8 rounded-lg border px-2.5 text-xs transition-colors duration-150",
            params.review ? "border-at-risk/55 bg-at-risk/14 text-at-risk" : "border-input bg-surface text-muted-foreground hover:border-strong hover:text-foreground",
          )}
        >
          Needs review
        </button>
        {filterCount > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              void setParams({ state: null, status: null, type: null, minAge: null, review: null, q: null });
            }}
          >
            <X className="size-3.5" aria-hidden />
            Clear {filterCount}
          </Button>
        ) : null}
        <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
          <kbd className="rounded border border-border px-1 font-mono">j</kbd> <kbd className="rounded border border-border px-1 font-mono">k</kbd> move · <kbd className="rounded border border-border px-1 font-mono">↵</kbd> open
        </span>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-border bg-surface">
        <div ref={tableRef} className="relative max-h-[calc(100vh-17rem)] min-h-64 overflow-auto">
          <table className="w-full text-[13px]" aria-label="Stale items">
            <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--border)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const meta = (h.column.columnDef.meta ?? {}) as ColMeta;
                    const dir = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                        className={cn("h-9 px-3 text-left text-[11px] font-medium tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase", meta.className)}
                      >
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn("inline-flex items-center gap-1 rounded uppercase hover:text-foreground", meta.align === "right" && "flex-row-reverse")}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {displayed.map((row) => {
                const selected = row.id === drawerItemId || row.id === activeId;
                return (
                  <tr
                    key={row.id}
                    data-row-id={row.id}
                    data-selected={selected || undefined}
                    onClick={() => {
                      setActiveId(row.id);
                      open(row.id);
                    }}
                    className={cn("min-h-11 cursor-pointer border-t sm:h-9 sm:min-h-0 border-border transition-colors duration-150 hover:bg-raised", selected && "bg-raised")}
                  >
                    {row.getVisibleCells().map((cell, i) => {
                      const meta = (cell.column.columnDef.meta ?? {}) as ColMeta;
                      return (
                        <td key={cell.id} className={cn("px-3 py-1.5 align-middle", meta.className)}>
                          {i === 0 ? (
                            <button
                              type="button"
                              aria-label={`Open ${row.original.payeeName}`}
                              className="rounded text-left"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveId(row.id);
                                open(row.id);
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </button>
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
              className="px-4"
              title="No items match these filters"
              description="Clear a filter or widen the age range."
              action={
                filterCount > 0 ? (
                  <Button size="sm" variant="outline" onClick={() => { setSearch(""); void setParams({ state: null, status: null, type: null, minAge: null, review: null, q: null }); }}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span data-testid="items-footer">
            <span className="font-mono text-foreground">{total}</span> items · <span className="font-mono text-foreground">{formatUSD(totalCents)}</span> as of {asOf}
          </span>
          <span className="hidden sm:inline">{filterCount > 0 ? "Filtered" : "All open items"}</span>
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
          <DrawerPrimitive.Popup
            initialFocus={false}
            data-testid="item-drawer"
            aria-label="Item details"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-strong bg-popover text-sm shadow-[0_24px_60px_-12px_rgba(0,0,0,.55)] transition duration-200 ease-out outline-none data-ending-style:translate-x-6 data-ending-style:opacity-0 data-starting-style:translate-x-6 data-starting-style:opacity-0 sm:w-[500px] sm:rounded-l-2xl"
          >
            <DrawerPrimitive.Title className="sr-only">Item details</DrawerPrimitive.Title>
            <DrawerPrimitive.Close
              aria-label="Close item details"
              className="absolute top-3 right-3 z-10 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-raised hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </DrawerPrimitive.Close>
            <div className="relative min-h-0 flex-1 overflow-y-auto">{drawer}</div>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </div>
  );
}
