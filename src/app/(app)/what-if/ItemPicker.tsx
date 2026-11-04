"use client";

import { useId, useState } from "react";
import { formatUSD } from "@/lib/money";
import type { ItemScenario, WhatIfItem } from "@/lib/what-if/types";
import { cn } from "@/lib/utils";
import { CHIP, CHIP_OFF } from "./Controls";

const SCENARIO_LABEL: Record<ItemScenario, string> = {
  none: "No response",
  paid: "Owner responds and is paid",
  next_report: "Remit with next report",
};

const PILL: Record<ItemScenario, string> = {
  none: "text-fg-3",
  paid: "border-blue-600 text-blue-300",
  next_report: "border-blue-800 text-blue-300",
};

function matches(i: WhatIfItem, q: string): boolean {
  if (!q) return true;
  const hay = `${i.payeeName} ${i.checkNumber ?? ""} ${i.ownerState ?? "unknown"}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w.replace(/^#/, "")));
}

interface ItemPickerProps {
  items: WhatIfItem[];
  scenarioOf: (id: string) => ItemScenario;
  onApply: (ids: string[], s: ItemScenario) => void;
}

/** Search + multi-select owners, then set what happens to them. Only the scenario is stored (in the URL). */
export function ItemPicker({ items, scenarioOf, onApply }: ItemPickerProps) {
  const searchId = useId();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<readonly string[]>([]);
  const visible = items.filter((i) => matches(i, q.trim()));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const apply = (s: ItemScenario) => {
    onApply([...picked], s);
    setPicked([]);
  };
  const changed = items.filter((i) => scenarioOf(i.id) !== "none").length;

  return (
    <div className="space-y-3" data-testid="wi-picker">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56 space-y-1">
          <label htmlFor={searchId} className="text-[13px] font-medium text-fg-1">
            Find items
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Payee, check number or state"
            className="h-9 w-full rounded-md border border-line bg-ink-1 px-3 text-sm text-fg-1 placeholder:text-fg-3 focus-visible:border-blue-500 focus-visible:outline-none"
          />
        </div>
        <p className="text-xs text-fg-3" aria-live="polite" data-testid="wi-picker-status">
          {picked.length} selected · {visible.length} shown · {changed} with a scenario
        </p>
      </div>

      <div role="group" aria-label="Apply to selected items" className="flex flex-wrap gap-1.5">
        {(["paid", "next_report", "none"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={picked.length === 0}
            onClick={() => apply(s)}
            data-testid={`wi-apply-${s}`}
            className={cn(CHIP, CHIP_OFF, "disabled:cursor-not-allowed disabled:opacity-50")}
          >
            {SCENARIO_LABEL[s]}
          </button>
        ))}
      </div>

      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-[10px] border border-line bg-ink-1" aria-label="Items">
        {visible.map((i) => {
          const s = scenarioOf(i.id);
          const cbId = `wi-cb-${i.id}`;
          return (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2" data-testid="wi-item-row" data-id={i.id} data-check={i.checkNumber ?? ""} data-cents={i.amountCents} data-scenario={s}>
              <input id={cbId} type="checkbox" checked={picked.includes(i.id)} onChange={() => toggle(i.id)} className="size-4 shrink-0 accent-blue-500" />
              <label htmlFor={cbId} className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="truncate text-fg-1">{i.payeeName}</span>
                <span className="num text-fg-3">#{i.checkNumber ?? "none"}</span>
                <span className="font-mono text-xs text-fg-3">{i.ownerState ?? "Unknown state"}</span>
              </label>
              <span className="num shrink-0 text-[13px] text-fg-2">{formatUSD(i.amountCents)}</span>
              <span className={cn("hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] sm:inline", PILL[s])}>{SCENARIO_LABEL[s]}</span>
            </li>
          );
        })}
        {visible.length === 0 ? <li className="px-3 py-4 text-[13px] text-fg-3">No items match “{q}”.</li> : null}
      </ul>
    </div>
  );
}
