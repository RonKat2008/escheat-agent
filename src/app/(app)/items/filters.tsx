"use client";

import { useState, type ComponentType } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { Kbd, STATUS_META } from "@/components/primitives";
import { PROPERTY_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHIP, type FilterOption } from "./filter-chip-style";
import { AGE_OPTIONS } from "./params";

type Option = FilterOption;

interface ChipProps {
  label: string;
  value: string | null;
  options: Option[];
  onChange: (v: string | null) => void;
  initialOpen?: boolean;
}

/**
 * One filter as a chip. Unset: quiet "State" with a caret. Set: "State  TX" with a separate clear button. The chip is
 * plain buttons in the first load; the single-choice popover (popover primitive) is code-split and loads on the first
 * click, which also opens it.
 */
function FilterChip({ label, value, options, onChange }: { label: string; value: string | null; options: Option[]; onChange: (v: string | null) => void }) {
  const [Full, setFull] = useState<ComponentType<ChipProps> | null>(null);
  if (Full) return <Full label={label} value={value} options={options} onChange={onChange} initialOpen />;
  const current = options.find((o) => o.value === value);
  const set = Boolean(current);
  return (
    <span className={cn(CHIP, set ? "border-line-strong bg-ink-3" : "border-line bg-transparent hover:border-line-hover hover:bg-ink-2")}>
      <button
        type="button"
        aria-label={set ? `${label}: ${current!.label}. Change` : `Filter by ${label.toLowerCase()}`}
        className={cn("inline-flex h-full items-center gap-1.5 rounded-md pl-2.5", set ? "pr-1" : "pr-2")}
        onClick={() => void import("./filter-chip-popover").then((mod) => setFull(() => mod.default as ComponentType<ChipProps>))}
      >
        <span className="text-fg-3">{label}</span>
        {set ? <span className="text-fg-1">{current!.label}</span> : <ChevronDown className="size-3.5 text-fg-3" strokeWidth={1.5} aria-hidden />}
      </button>
      {set ? (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()} filter`}
          onClick={() => onChange(null)}
          className="mr-0.5 grid size-6 place-items-center rounded-[5px] text-fg-3 transition-colors duration-150 hover:bg-ink-2 hover:text-fg-1"
        >
          <X className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

const STATES: Option[] = ["CA", "DE", "TX"].map((s) => ({ value: s, label: s }));
const STATUSES: Option[] = ["to_report", "dd_pending", "owner_responded", "dd_sent", "needs_rule", "watching", "reported", "resolved_paid", "remitted"].map((s) => ({
  value: s,
  label: STATUS_META[s]?.label ?? s,
}));
const TYPES: Option[] = Object.entries(PROPERTY_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const AGES: Option[] = AGE_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }));

export interface FilterValues {
  state: string | null;
  status: string | null;
  type: string | null;
  minAge: number | null;
  review: boolean | null;
  overdue: boolean | null;
}

export function FilterBar({
  search,
  onSearch,
  values,
  onChange,
  onClear,
  filterCount,
  overdueCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  onClear: () => void;
  filterCount: number;
  /** Open items with a missed deadline, across all filters. */
  overdueCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filter items">
      <label className="relative w-full sm:w-60">
        <span className="sr-only">Search payee or check number</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" strokeWidth={1.5} aria-hidden />
        <input
          type="search"
          data-testid="items-search"
          aria-keyshortcuts="/"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search payee or check #"
          className="h-8 w-full rounded-md border border-line bg-ink-1 pr-2 pl-8 text-[13px] text-fg-1 transition-[border-color] duration-150 outline-none placeholder:text-fg-3 hover:border-line-hover focus-visible:border-blue-400 focus-visible:outline-none"
        />
      </label>
      <FilterChip label="State" value={values.state} options={STATES} onChange={(v) => onChange({ state: v })} />
      <FilterChip label="Status" value={values.status} options={STATUSES} onChange={(v) => onChange({ status: v })} />
      <FilterChip label="Type" value={values.type} options={TYPES} onChange={(v) => onChange({ type: v })} />
      <FilterChip label="Age" value={values.minAge ? String(values.minAge) : null} options={AGES} onChange={(v) => onChange({ minAge: v ? Number(v) : null })} />
      <button
        type="button"
        aria-pressed={Boolean(values.overdue)}
        data-testid="filter-overdue"
        title="Items with a report, remittance or due-diligence close date already in the past"
        onClick={() => onChange({ overdue: values.overdue ? null : true })}
        className={cn(
          CHIP,
          "px-2.5",
          values.overdue
            ? "border-pink-500/60 bg-pink-900/50 text-pink-300"
            : overdueCount > 0
              ? "border-pink-500/40 text-pink-300 hover:border-pink-500/60 hover:bg-pink-900/30"
              : "border-line text-fg-3 hover:border-line-hover hover:bg-ink-2 hover:text-fg-2",
        )}
      >
        Overdue <span className="num">{overdueCount}</span>
      </button>
      <button
        type="button"
        aria-pressed={Boolean(values.review)}
        title="Items whose classification confidence is low, or that no rule covers yet"
        onClick={() => onChange({ review: values.review ? null : true })}
        className={cn(
          CHIP,
          "px-2.5",
          values.review ? "border-pink-500/60 bg-pink-900/50 text-pink-300" : "border-line text-fg-3 hover:border-line-hover hover:bg-ink-2 hover:text-fg-2",
        )}
      >
        Needs review
      </button>
      {filterCount > 0 ? (
        <button type="button" onClick={onClear} className="h-8 rounded-md px-2 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg-1">
          Clear {filterCount}
        </button>
      ) : null}
      <span className="ml-auto hidden items-center gap-1.5 text-xs text-fg-3 lg:inline-flex">
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        <span className="mr-1.5">move</span>
        <Kbd>↵</Kbd>
        <span className="mr-1.5">open</span>
        <Kbd>x</Kbd>
        <span className="mr-1.5">select</span>
        <Kbd>d</Kbd>
        <span>draft</span>
      </span>
    </div>
  );
}
