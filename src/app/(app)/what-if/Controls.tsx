"use client";

import { cn } from "@/lib/utils";

const PRESETS = [
  { days: 0, label: "Today" },
  { days: 30, label: "+30d" },
  { days: 90, label: "+90d" },
  { days: 180, label: "+180d" },
  { days: 365, label: "+1y" },
  { days: 730, label: "+2y" },
] as const;

export const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 motion-reduce:transition-none";
export const CHIP_OFF = "border-line text-fg-2 hover:border-line-hover hover:text-fg-1";
export const CHIP_ON = "border-blue-500 bg-blue-900/70 text-fg-1";

export function OffsetPresets({ offset, onOffset }: { offset: number; onOffset: (n: number) => void }) {
  return (
    <div role="group" aria-label="Jump to" className="flex flex-wrap gap-1.5">
      {PRESETS.map((p) => (
        <button key={p.days} type="button" aria-pressed={offset === p.days} onClick={() => onOffset(p.days)} className={cn(CHIP, offset === p.days ? CHIP_ON : CHIP_OFF)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

export interface ScenarioChip {
  key: string;
  label: string;
  active: boolean;
  /** Click handler. Chips with `toggle` run it both ways (pressed -> off), so every pressed chip can be un-pressed. */
  apply: () => void;
  /** Baseline chip: pressed when there is nothing to undo; shown as a state, not a button (R9-09). */
  disabled?: boolean;
  hint?: string;
}

export function ScenarioChips({ chips }: { chips: ScenarioChip[] }) {
  return (
    <div role="group" aria-label="Scenarios" className="flex flex-wrap gap-1.5" data-testid="wi-chips">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={c.active}
          disabled={c.disabled}
          title={c.hint}
          onClick={c.apply}
          className={cn(CHIP, c.active ? CHIP_ON : CHIP_OFF, c.disabled && "cursor-default active:scale-100")}
          data-testid={`wi-chip-${c.key}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** One segmented control per state: miss its due dates (the default) or file and remit on them. */
export function StateToggles({ states, onTime, onToggle }: { states: string[]; onTime: readonly string[]; onToggle: (state: string, on: boolean) => void }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Per-state filing">
      {states.map((s) => {
        const on = onTime.includes(s);
        return (
          <li key={s} className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-ink-1 py-1.5 pr-1.5 pl-3" data-testid={`wi-state-${s}`}>
            <span className="font-mono text-sm text-fg-1">{s}</span>
            <div role="group" aria-label={`${s} due dates`} className="inline-flex h-8 items-center rounded-md border border-line bg-ink-0 p-0.5">
              {[
                { v: false, label: "Miss it" },
                { v: true, label: "File & remit on due date" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={on === o.v}
                  onClick={() => onToggle(s, o.v)}
                  className={cn(
                    "h-full rounded-[5px] px-2.5 text-[12px] whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none sm:text-[13px]",
                    on === o.v ? (o.v ? "bg-blue-900 text-fg-1 shadow-[inset_0_0_0_1px_var(--color-blue-600)]" : "bg-ink-3 text-fg-1") : "text-fg-3 hover:text-fg-1",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
