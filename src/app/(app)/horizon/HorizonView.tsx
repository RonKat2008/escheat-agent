"use client";

import { useId, useMemo, useState } from "react";
import { Money, UnknownValue, UnverifiedBadge, UnverifiedBanner } from "@/components/primitives";
import { ACT_NOW_DAYS, HorizonRadar, type RadarItem } from "@/components/viz/horizon-radar/HorizonRadar";
import { addDays, type IsoDate } from "@/lib/dates";
import { formatDate, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { StaleBucket } from "@/lib/horizon/buckets";
import { phaseAtAge, type HorizonPhase } from "@/lib/horizon/phase";
import type { HorizonItem } from "@/lib/horizon/project";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Worklist } from "./Worklist";

export interface HorizonRing {
  days: number;
  label: string;
  unverified: boolean;
  states: string[];
  types: string[];
}

export interface HorizonViewProps {
  asOf: string;
  thresholdDays: number;
  items: HorizonItem[];
  totalCents: number;
  buckets: StaleBucket[];
  rings: HorizonRing[];
  awaitingDetection: { count: number; cents: number };
}

/** The scrubber's reach: one year past the demo clock. */
const MAX_OFFSET = 365;
const PRESETS = [0, 30, 90, 180, 365] as const;

const PHASE_TEXT: Record<HorizonPhase, string> = {
  outstanding: "Outstanding, not yet stale",
  stale: "Stale (business policy)",
  presumed_abandoned: "Presumed abandoned (projected)",
};

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

function dotLabel(i: HorizonItem): string {
  const legal = i.dates?.presumedAbandoned ? `projected presumed abandoned ${formatDate(i.dates.presumedAbandoned)}` : "legal dates unknown";
  return `${i.payeeName}, ${formatUSD(i.amountCents)}, stale in ${days(i.daysUntilStale)}, ${legal}`;
}

function BucketStrip({ buckets }: { buckets: StaleBucket[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="horizon-buckets" aria-label="Amount becoming stale by when">
      {buckets.map((b) => (
        <li
          key={b.key}
          data-testid="horizon-bucket"
          data-cents={b.cents}
          data-count={b.count}
          className={cn(
            "relative overflow-hidden rounded-[10px] border bg-ink-2 px-3.5 py-3",
            b.key === "d30" && b.count > 0 ? "border-pink-700/70" : "border-line",
          )}
        >
          <p className={cn("num text-xl font-semibold tracking-[-0.01em]", b.key === "d30" && b.count > 0 ? "text-pink-400" : "text-fg-1")}>
            <Money cents={b.cents} wholeDollars />
          </p>
          <p className="text-[13px] text-fg-2">becomes stale {b.label}</p>
          <p className="text-xs text-fg-3">{b.count === 1 ? "1 payment" : `${b.count} payments`}</p>
        </li>
      ))}
    </ul>
  );
}

function Readout({ item, offset, asOf, thresholdDays }: { item: HorizonItem | null; offset: number; asOf: string; thresholdDays: number }) {
  if (!item) {
    return (
      <div className="space-y-2 text-[13px] text-fg-2" data-testid="horizon-readout">
        <p className="text-fg-1">Hover, tap, or tab to a dot to see the payment.</p>
        <p>Dot size is the amount. Pink dots go stale within {ACT_NOW_DAYS} days; hollow dashed dots have no known legal dates.</p>
      </div>
    );
  }
  const age = item.ageDays + offset;
  const until = Math.max(0, item.daysUntilStale - offset);
  const phase = phaseAtAge(age, thresholdDays, item.presumedAtAgeDays);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]" data-testid="horizon-readout" aria-live="polite">
      <dt className="sr-only">Payee</dt>
      <dd className="col-span-2 text-sm font-medium text-fg-1">{item.payeeName}</dd>
      <dt className="text-fg-3">Amount</dt>
      <dd>
        <Money cents={item.amountCents} /> <span className="text-fg-3">· {PROPERTY_TYPE_LABEL[item.propertyType] ?? item.propertyType}</span>
      </dd>
      <dt className="text-fg-3">Check / ref</dt>
      <dd className="num text-fg-2">{item.checkNumber ?? "None"}</dd>
      <dt className="text-fg-3">{offset > 0 ? `At +${offset} days` : "Today"}</dt>
      <dd className={cn(phase === "outstanding" ? "text-fg-1" : "text-pink-400")}>
        {PHASE_TEXT[phase]}
        {offset > 0 ? <span className="text-fg-3"> ({formatDate(addDays(asOf as IsoDate, offset))})</span> : null}
      </dd>
      <dt className="text-fg-3">Stale in</dt>
      <dd className="num" data-testid="readout-stale-in">
        {until === 0 ? "already stale at this point" : days(until)} <span className="text-fg-3">· stale on {formatDate(item.staleOn)}</span>
      </dd>
      <dt className="text-fg-3">Owner state</dt>
      <dd>{item.ownerState ? <span>{item.ownerState} <span className="text-fg-3">(provisional, from the address)</span></span> : <UnknownValue reason="No state in the payee address." />}</dd>
      <dt className="text-fg-3">Presumed abandoned</dt>
      <dd>
        {item.dates ? (
          <span className="inline-flex items-center gap-1.5">
            {formatDate(item.dates.presumedAbandoned)} {item.dates.unverified ? <UnverifiedBadge /> : null}
          </span>
        ) : (
          <UnknownValue reason={item.unknownReason ?? undefined} />
        )}
      </dd>
      <dt className="text-fg-3">Report due</dt>
      <dd>{item.dates?.reportDue ? formatDate(item.dates.reportDue) : <UnknownValue />}</dd>
      <dt className="text-fg-3">Remit due</dt>
      <dd>{item.dates?.remitDue ? formatDate(item.dates.remitDue) : <UnknownValue />}</dd>
      {item.dates?.ruleVersion ? (
        <>
          <dt className="text-fg-3">Rule</dt>
          <dd className="font-mono text-xs text-fg-3">
            {item.ownerState}@{item.dates.ruleVersion}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function Scrubber({ offset, onChange, asOf }: { offset: number; onChange: (n: number) => void; asOf: string }) {
  const id = useId();
  return (
    <div className="space-y-2" data-testid="horizon-scrubber">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-fg-1">
          Project forward
        </label>
        <output htmlFor={id} className="num text-sm text-fg-1" data-testid="horizon-offset">
          +{offset} days
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={MAX_OFFSET}
        step={1}
        value={offset}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`plus ${offset} days, ${formatDate(addDays(asOf as IsoDate, offset))}`}
        className="w-full accent-blue-500"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Jump to">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={offset === p}
            className="rounded-[5px] border border-line px-2 py-0.5 font-mono text-xs text-fg-2 hover:border-line-hover hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400 aria-pressed:border-blue-500 aria-pressed:text-fg-1"
          >
            {p === 0 ? "Today" : `+${p}d`}
          </button>
        ))}
      </div>
      <p className="text-xs text-fg-3">
        A projection only. The demo clock stays at {formatDate(asOf)}; nothing is saved.
      </p>
    </div>
  );
}

export function HorizonView({ asOf, thresholdDays, items, totalCents, buckets, rings, awaitingDetection }: HorizonViewProps) {
  const [offset, setOffset] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = items.find((i) => i.ledgerItemId === activeId) ?? null;

  const radarItems: RadarItem[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.ledgerItemId,
        label: dotLabel(i),
        ageDays: i.ageDays,
        amountCents: i.amountCents,
        daysUntilStale: i.daysUntilStale,
        datesKnown: i.dates !== null,
      })),
    [items],
  );
  const dormancy = useMemo(() => rings.map((r) => ({ days: r.days, label: r.label, unverified: r.unverified })), [rings]);
  const counts = items.reduce(
    (acc, i) => {
      acc[phaseAtAge(i.ageDays + offset, thresholdDays, i.presumedAtAgeDays)] += 1;
      return acc;
    },
    { outstanding: 0, stale: 0, presumed_abandoned: 0 } as Record<HorizonPhase, number>,
  );
  const at = offset > 0 ? `At +${offset} days (${formatDate(addDays(asOf as IsoDate, offset))})` : `Today (${formatDate(asOf)}, demo clock)`;
  const summary = `${at}: ${counts.outstanding} not yet stale, ${counts.stale} stale, ${counts.presumed_abandoned} presumed abandoned, of ${items.length} outstanding payments totalling ${formatUSD(totalCents)}.`;
  const anyUnverified = rings.some((r) => r.unverified) || items.some((i) => i.dates?.unverified);

  const table = {
    caption: `Outstanding payments not yet stale, as of ${formatDate(asOf)}`,
    columns: ["Payee", "Amount", "Stale in", "Owner state (provisional)", "Presumed abandoned (projected)"],
    rows: items.map((i) => [
      i.payeeName,
      formatUSD(i.amountCents),
      days(i.daysUntilStale),
      i.ownerState ?? "Unknown",
      i.dates?.presumedAbandoned ? `${formatDate(i.dates.presumedAbandoned)}${i.dates.unverified ? " (unverified)" : ""}` : "Unknown",
    ]),
  };

  if (items.length === 0) {
    return (
      <div className="rounded-[10px] border border-line bg-ink-2 p-6 text-sm text-fg-2" data-testid="horizon-empty" data-count={0}>
        No outstanding payments are approaching the {thresholdDays}-day stale line as of {formatDate(asOf)}.
        {awaitingDetection.count > 0 ? ` ${awaitingDetection.count} already crossed it and wait for the next detection run.` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="horizon" data-count={items.length} data-total-cents={totalCents} data-as-of={asOf}>
      <BucketStrip buckets={buckets} />
      <p className="max-w-3xl text-[13px] text-fg-3" data-testid="horizon-basis">
        As of {formatDate(asOf)} (demo clock). The {thresholdDays}-day stale line is business policy (a setting), not law. Presumed-abandoned
        points come from the rules engine for the owner state in the payee address, a provisional classification; no address state means
        unknown dates.
        {awaitingDetection.count > 0
          ? ` ${awaitingDetection.count} more (${formatUSD(awaitingDetection.cents)}) already crossed the stale line and wait for the next detection run.`
          : ""}
      </p>
      {anyUnverified ? <UnverifiedBanner /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="min-w-0 overflow-hidden rounded-[14px] border border-line bg-[radial-gradient(ellipse_at_50%_30%,var(--color-ink-2),var(--color-ink-0)_70%)] py-6">
          <p className="mb-2 px-4 text-center text-[13px] text-fg-2" data-testid="horizon-at" aria-live="polite">
            {summary}
          </p>
          <HorizonRadar
            items={radarItems}
            thresholdDays={thresholdDays}
            dormancy={dormancy}
            offsetDays={offset}
            activeId={activeId}
            onActive={setActiveId}
            table={table}
            summary={summary}
          />
        </div>
        <aside className="space-y-5 rounded-[10px] border border-line bg-ink-2 p-4" aria-label="Projection and selected payment">
          <Scrubber offset={offset} onChange={setOffset} asOf={asOf} />
          <div className="border-t border-line pt-4">
            <Readout item={active} offset={offset} asOf={asOf} thresholdDays={thresholdDays} />
          </div>
        </aside>
      </div>

      <Worklist items={items} totalCents={totalCents} activeId={activeId} onActive={setActiveId} />
    </div>
  );
}
