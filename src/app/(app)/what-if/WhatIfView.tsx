"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueryStates } from "nuqs";
import { RotateCcw } from "lucide-react";
import { UnverifiedBanner } from "@/components/primitives";
import { addDays, type IsoDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { delta, project, timelineEvents } from "@/lib/what-if/project";
import { EMPTY_SCENARIO, normalizeScenario } from "@/lib/what-if/scenario";
import { buildMarks, LANES } from "@/lib/what-if/timeline-model";
import { UNKNOWN_STATE, type ItemScenario, type WhatIfSnapshot } from "@/lib/what-if/types";
import { cn } from "@/lib/utils";
import { SIMULATION_NOTE } from "./copy";
import { CHIP, CHIP_OFF, OffsetPresets, ScenarioChips, StateToggles, type ScenarioChip } from "./Controls";
import { DeltaCards } from "./DeltaCards";
import { ItemPicker } from "./ItemPicker";
import { whatIfParsers } from "./params";
import { StateTable } from "./StateTable";
import { Timeline } from "./Timeline";

const LARGEST_N = 5;

function Panel({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-3 border-t border-line pt-5" aria-label={title} data-testid={testId}>
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-fg-1">{title}</h2>
        {hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function WhatIfView({ snapshot }: { snapshot: WhatIfSnapshot }) {
  const [params, setParams] = useQueryStates(whatIfParsers, { history: "replace", scroll: false });
  const scenario = useMemo(
    () => normalizeScenario({ offset: params.d, paid: params.paid, nextReport: params.next, onTimeStates: params.file }, snapshot),
    [params.d, params.paid, params.next, params.file, snapshot],
  );
  const base = useMemo(() => project(snapshot, EMPTY_SCENARIO), [snapshot]);
  const next = useMemo(() => project(snapshot, scenario), [snapshot, scenario]);
  const events = useMemo(() => timelineEvents(snapshot, scenario), [snapshot, scenario]);
  const marks = useMemo(() => buildMarks(events, snapshot.today as IsoDate), [events, snapshot.today]);
  const change = delta(base, next);

  const states = useMemo(() => [...new Set(snapshot.items.map((i) => i.ownerState ?? UNKNOWN_STATE))].filter((s) => s !== UNKNOWN_STATE).sort(), [snapshot.items]);
  const at = addDays(snapshot.today as IsoDate, scenario.offset);
  const atLabel = scenario.offset === 0 ? "today" : `at +${scenario.offset}d`;
  const isEmpty = scenario.paid.length === 0 && scenario.nextReport.length === 0 && scenario.onTimeStates.length === 0;

  const setOffset = (d: number) => void setParams({ d: d === 0 ? null : d });
  const setStates = (file: string[]) => void setParams({ file: file.length ? file : null });
  const scenarioOf = (id: string): ItemScenario => (scenario.paid.includes(id) ? "paid" : scenario.nextReport.includes(id) ? "next_report" : "none");
  const applyItems = (ids: string[], s: ItemScenario) => {
    const without = (xs: readonly string[]) => xs.filter((x) => !ids.includes(x));
    const paid = s === "paid" ? [...without(scenario.paid), ...ids] : without(scenario.paid);
    const nextReport = s === "next_report" ? [...without(scenario.nextReport), ...ids] : without(scenario.nextReport);
    void setParams({ paid: paid.length ? paid : null, next: nextReport.length ? nextReport : null });
  };
  const largest = [...snapshot.items].sort((a, b) => b.amountCents - a.amountCents || a.id.localeCompare(b.id)).slice(0, LARGEST_N).map((i) => i.id);

  const chips: ScenarioChip[] = [
    { key: "nothing", label: "Do nothing", active: isEmpty, apply: () => void setParams({ paid: null, next: null, file: null }) },
    { key: "all-on-time", label: "File every state on time", active: states.length > 0 && states.every((s) => scenario.onTimeStates.includes(s)), apply: () => setStates(states) },
    ...(states.includes("CA") ? [{ key: "ca-now", label: "File CA on time", active: scenario.onTimeStates.includes("CA"), apply: () => setStates([...new Set([...scenario.onTimeStates, "CA"])]) }] : []),
    {
      key: "largest-respond",
      label: `${LARGEST_N} largest owners respond`,
      active: largest.length > 0 && largest.every((id) => scenario.paid.includes(id)),
      apply: () => applyItems(largest, "paid"),
    },
  ];

  const anyUnverified = next.deadlines.anyUnverified || next.interest.anyUnverified || snapshot.items.some((i) => i.unverified);

  return (
    <div className="space-y-8" data-testid="what-if" data-today={snapshot.today} data-offset={scenario.offset} data-count={snapshot.items.length}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="note" className="flex items-center gap-2 rounded-full border border-blue-800 bg-blue-950 px-3 py-1 text-[13px] text-blue-200" data-testid="wi-note">
          <span aria-hidden className="size-1.5 rounded-full bg-blue-400" />
          {SIMULATION_NOTE}
        </p>
        <button
          type="button"
          onClick={() => void setParams({ d: null, paid: null, next: null, file: null })}
          className={cn(CHIP, CHIP_OFF, "h-9")}
          data-testid="wi-reset"
        >
          <RotateCcw className="size-3.5" aria-hidden /> Reset to today
        </button>
      </div>

      <DeltaCards next={next} change={change} atLabel={atLabel} />

      <div className="space-y-4 rounded-[14px] border border-line bg-[radial-gradient(ellipse_at_20%_0%,var(--color-blue-950),var(--color-ink-0)_65%)] p-4 sm:p-5">
        <Timeline today={snapshot.today} offset={scenario.offset} marks={marks} onOffset={setOffset} />
        <OffsetPresets offset={scenario.offset} onOffset={setOffset} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-[13px] sm:grid-cols-5" data-testid="wi-crossings" aria-label={`Crossed between today and ${formatDate(at)}`}>
          {LANES.map((l) => (
            <div key={l.kind} className="min-w-0">
              <dt className="truncate text-xs text-fg-3">{l.label}</dt>
              <dd className="num text-fg-1" data-testid={`wi-cross-${l.kind}`}>
                {next.crossings[l.kind]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {anyUnverified ? <UnverifiedBanner /> : null}

      <Panel title="Scenarios" hint="Shareable: the scenario lives in the page address.">
        <ScenarioChips chips={chips} />
      </Panel>

      <Panel title="Each state's due dates" hint="Missing is the default. On time: due-diligence letters go out when the window opens, the report is filed and the money remitted on their due dates. A step already late today is done today; it cannot be made on time.">
        <StateToggles states={states} onTime={scenario.onTimeStates} onToggle={(s, on) => setStates(on ? [...scenario.onTimeStates, s] : scenario.onTimeStates.filter((x) => x !== s))} />
      </Panel>

      <Panel title="Owner responses" hint="Pick items, then say what happens. A paid item leaves exposure and accrues no interest.">
        <ItemPicker items={snapshot.items} scenarioOf={scenarioOf} onApply={applyItems} />
      </Panel>

      <Panel title="By state" testId="wi-by-state">
        <StateTable base={base} next={next} atLabel={atLabel} />
      </Panel>

      <Panel title="How this is computed">
        <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-[13px] text-fg-2" data-testid="wi-basis">
          <li>Today is the demo clock ({formatDate(snapshot.today)}). The simulator never moves it and never writes anything.</li>
          <li>Exposure counts open, unfiled stale items, the same as the dashboard. Payments not yet stale are on the <Link href="/horizon" className="text-blue-300 underline underline-offset-2 hover:text-blue-200">Pre-stale Horizon</Link>.</li>
          <li>Every date is the rules engine&apos;s output for that item. An unknown date is shown as unknown and never counted as missed.</li>
          <li>Audit interest uses each state&apos;s sourced interest rule (for example CA CCP § 1577, 12% simple). A missing or unsupported rule is UNKNOWN, not guessed. On a late catch-up filing, interest stops on the simulated filing date: a scenario assumption, not a rule value.</li>
        </ul>
      </Panel>
    </div>
  );
}
