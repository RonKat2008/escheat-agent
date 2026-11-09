"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useQueryStates } from "nuqs";
import { ArrowUpRight, X } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Waterfall } from "@/components/viz/waterfall/Waterfall";
import { waterfallModel, type WaterfallStep } from "@/components/viz/waterfall/waterfall-model";
import { formatDate, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { PeriodId, Roll } from "@/lib/ledger/rollforward";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ledgerParsers } from "./params";

export type BarKey = "opening" | "identified" | "resolved" | "cleared_late" | "remitted" | "closing";

export interface BarItem {
  id: string;
  payee: string;
  check: string | null;
  cents: number;
  date: string;
  state: string;
  type: string;
}

export const BAR_LABEL: Record<BarKey, string> = {
  opening: "Opening",
  identified: "Identified",
  resolved: "Resolved with owner",
  cleared_late: "Cleared late by bank",
  remitted: "Remitted",
  closing: "Closing",
};

/** The Items filter that lists a bar's items, where one exists (identified-in-period has no status of its own). */
const ITEMS_STATUS: Partial<Record<BarKey, string>> = { resolved: "resolved_paid", cleared_late: "resolved_paid", remitted: "remitted" };

export function steps(roll: Roll, showClearedLate: boolean): (WaterfallStep & { id: BarKey })[] {
  const all: (WaterfallStep & { id: BarKey })[] = [
    { id: "opening", label: BAR_LABEL.opening, cents: roll.opening, direction: "total" },
    { id: "identified", label: BAR_LABEL.identified, cents: roll.identified, direction: "up" },
    { id: "resolved", label: BAR_LABEL.resolved, cents: roll.resolved, direction: "down" },
    { id: "cleared_late", label: BAR_LABEL.cleared_late, cents: roll.clearedLate, direction: "down" },
    { id: "remitted", label: BAR_LABEL.remitted, cents: roll.remitted, direction: "down" },
    { id: "closing", label: BAR_LABEL.closing, cents: roll.closing, direction: "total" },
  ];
  return showClearedLate ? all : all.filter((s) => s.id !== "cleared_late");
}

const PERIOD_OPTIONS: { value: PeriodId; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "Quarter" },
  { value: "fy", label: "FY" },
  { value: "all", label: "Since start" },
];

/** Period chips: URL state (nuqs), re-rendered on the server so the CSV link and the journal follow. */
export function PeriodChips({ fyLabel }: { fyLabel: string }) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(ledgerParsers, { shallow: false, startTransition });
  return (
    <div data-testid="ledger-period" data-pending={pending ? "true" : "false"} className={cn("transition-opacity duration-150", pending && "opacity-60")}>
      <Segmented
        label="Period"
        value={params.period}
        onValueChange={(period) => void setParams({ period })}
        options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.value === "fy" ? fyLabel : o.label }))}
      />
    </div>
  );
}

interface LedgerViewProps {
  total: Roll;
  states: Roll[];
  behind: Record<BarKey, BarItem[]>;
  showClearedLate: boolean;
  periodLabel: string;
  periodKey: string;
}

const PANEL_ID = "ledger-bar-items";
const MAX_ROWS = 60;

/** The waterfall for the total or one owner state, with the items behind the selected bar. */
export function LedgerView({ total, states, behind, showClearedLate, periodLabel, periodKey }: LedgerViewProps) {
  const [{ state }, setParams] = useQueryStates(ledgerParsers, { shallow: true });
  const [selected, setSelected] = useState<BarKey | null>(null);
  const roll = states.find((s) => s.state === state) ?? total;
  const scope = roll === total ? null : roll.state;
  const model = waterfallModel(steps(roll, showClearedLate));
  const itemsFor = (k: BarKey) => (scope ? behind[k].filter((i) => i.state === scope) : behind[k]);
  const counts = Object.fromEntries(model.bars.map((b) => [b.id, itemsFor(b.id as BarKey).length]));
  const sel = selected ? model.bars.find((b) => b.id === selected) : undefined;
  const rows = selected ? itemsFor(selected) : [];
  const status = selected ? ITEMS_STATUS[selected] : undefined;
  const itemsHref = status ? `/items?status=${status}${scope ? `&state=${scope}` : ""}` : scope ? `/items?state=${scope}` : "/items";
  const scopeOptions = [{ value: "ALL", label: "All states" }, ...states.map((s) => ({ value: s.state, label: s.state }))];

  return (
    <div className="min-w-0" data-testid="ledger-waterfall" data-scope={scope ?? "ALL"}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-2">
          <span className="text-fg-1">{scope ?? "All owner states"}</span> · {periodLabel}
        </p>
        <Segmented
          size="sm"
          label="Owner state"
          value={scope ?? "ALL"}
          onValueChange={(v) => {
            setSelected(null);
            void setParams({ state: v === "ALL" ? null : v });
          }}
          options={scopeOptions}
        />
      </div>
      <Waterfall
        bars={model.bars}
        counts={counts}
        selected={selected}
        onSelect={(id) => setSelected((cur) => (cur === id ? null : (id as BarKey)))}
        caption={`Liability roll-forward, ${scope ?? "all owner states"}, ${periodLabel}: ${model.bars.map((b) => `${b.label} ${b.display}`).join(", ")}.`}
        animateKey={`${periodKey}-${scope ?? "ALL"}`}
        panelId={PANEL_ID}
      />
      <div id={PANEL_ID} aria-live="polite" className="mt-5">
        {sel && selected ? (
          <section aria-labelledby="ledger-bar-items-h" data-testid="ledger-bar-items" data-bar-id={selected} className="relative overflow-hidden glass rounded-[18px]">
            <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-blue-500/80 via-blue-500/25 to-transparent" />
            <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
              <div className="min-w-0">
                <h3 id="ledger-bar-items-h" className="text-sm font-medium text-fg-1">
                  {sel.label} <span className="num text-fg-2">{sel.display}</span>
                </h3>
                <p className="mt-0.5 text-xs text-fg-3">
                  {rows.length} {rows.length === 1 ? "item" : "items"} · {scope ?? "all states"} · {periodLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="-mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-ink-3 hover:text-fg-1"
                aria-label="Close the item list"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 pt-2 pb-4 text-[13px] text-fg-2">Nothing moved on this line in the period.</p>
            ) : (
              <ul className="mt-2 max-h-[320px] overflow-y-auto border-t border-line">
                {rows.slice(0, MAX_ROWS).map((r) => (
                  <li key={r.id} className="border-b border-line last:border-b-0">
                    <Link href={`/items?item=${r.id}`} className="group flex items-baseline gap-3 px-4 py-2 transition-colors duration-150 hover:bg-ink-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">
                        {r.payee}
                        <span className="ml-2 text-xs text-fg-3">
                          {r.state} · {PROPERTY_TYPE_LABEL[r.type] ?? r.type}
                          {r.check ? ` · #${r.check}` : ""}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-xs text-fg-3 sm:inline">{formatDate(r.date)}</span>
                      <span className="num shrink-0 text-[13px] text-fg-1">{formatUSD(r.cents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-line bg-ink-1/60 px-4 py-2">
              <span className="text-xs text-fg-3">{rows.length > MAX_ROWS ? `Showing ${MAX_ROWS} of ${rows.length}` : "Dates are demo-clock dates"}</span>
              <Link href={itemsHref} className="inline-flex items-center gap-1 text-xs text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg-1 hover:decoration-blue-400">
                Open in Items
                <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
              </Link>
            </div>
          </section>
        ) : (
          <p className="text-xs text-fg-3">Select a bar to see the items behind it.</p>
        )}
      </div>
    </div>
  );
}
