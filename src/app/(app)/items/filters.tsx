"use client";

import { useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Kbd, STATUS_META } from "@/components/primitives";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROPERTY_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AGE_OPTIONS } from "./params";

interface Option {
  value: string;
  label: string;
}

const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-md border text-[13px] whitespace-nowrap transition-[background-color,border-color,color] duration-150";

/**
 * One filter as a chip. Unset: quiet "State" with a caret. Set: "State  TX" with a separate clear button.
 * The popover lists options as a single-choice menu.
 */
function FilterChip({ label, value, options, onChange }: { label: string; value: string | null; options: Option[]; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const set = Boolean(current);
  return (
    <span className={cn(CHIP, set ? "border-line-strong bg-ink-3" : "border-line bg-transparent hover:border-line-hover hover:bg-ink-2")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={set ? `${label}: ${current!.label}. Change` : `Filter by ${label.toLowerCase()}`}
              className={cn("inline-flex h-full items-center gap-1.5 rounded-md pl-2.5", set ? "pr-1" : "pr-2")}
            />
          }
        >
          <span className="text-fg-3">{label}</span>
          {set ? <span className="text-fg-1">{current!.label}</span> : <ChevronDown className="size-3.5 text-fg-3" strokeWidth={1.5} aria-hidden />}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <div role="listbox" aria-label={label}>
            <OptionRow label={`Any ${label.toLowerCase()}`} selected={!set} onSelect={() => { onChange(null); setOpen(false); }} />
            {options.map((o) => (
              <OptionRow key={o.value} label={o.label} selected={o.value === value} onSelect={() => { onChange(o.value); setOpen(false); }} />
            ))}
          </div>
        </PopoverContent>
      </Popover>
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

function OptionRow({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors duration-100 hover:bg-ink-2",
        selected ? "text-fg-1" : "text-fg-2",
      )}
    >
      <Check className={cn("size-3.5 text-blue-400", !selected && "invisible")} strokeWidth={2} aria-hidden />
      {label}
    </button>
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
}

export function FilterBar({
  search,
  onSearch,
  values,
  onChange,
  onClear,
  filterCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  onClear: () => void;
  filterCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filter items">
      <label className="relative w-full sm:w-60">
        <span className="sr-only">Search payee or check number</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" strokeWidth={1.5} aria-hidden />
        <input
          type="search"
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
        aria-pressed={Boolean(values.review)}
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
        <span>open</span>
      </span>
    </div>
  );
}
