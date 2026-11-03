"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CHIP, type FilterOption as Option } from "./filter-chip-style";

/**
 * The popover version of a filter chip (loaded on the first click, see FilterChip in filters.tsx). One filter as a chip. Unset: quiet "State" with a caret. Set: "State  TX" with a separate clear button.
 * The popover lists options as a single-choice menu.
 */
export default function FilterChipPopover({ label, value, options, onChange, initialOpen = false }: { label: string; value: string | null; options: Option[]; onChange: (v: string | null) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
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

