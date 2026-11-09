"use client";

import { useId, useMemo, useState } from "react";
import { Money, UnknownValue, UnverifiedBadge, UnverifiedBanner } from "@/components/primitives";
import { ACT_NOW_DAYS, HorizonRadar, type RadarItem } from "@/components/viz/horizon-radar/HorizonRadar";
import { addDays, type IsoDate } from "@/lib/dates";
import { formatDate, PROPERTY_TYPE_LABEL } from "@/lib/format";
import { phaseAtAge, type HorizonPhase } from "@/lib/horizon/phase";
import type { HorizonItem } from "@/lib/horizon/project";
import { bucketsAt, type ScrubbedBuckets } from "@/lib/horizon/scrub";
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
  rings: HorizonRing[];
  awaitingDetection: { count: number; cents: number };
  /** States this app has a rule file for (the only ones it can project and file). */
  ruleStates: string[];
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

function Tile({ cents, count, tone, label }: { cents: number; count: number; tone: "urgent" | "plain" | "done"; label: string }) {
  return (
    <li
      data-testid="horizon-bucket"
      data-cents={cents}
      data-count={count}
      className={cn("relative overflow-hidden rounded-[10px] border bg-ink-2 px-3.5 py-3", tone === "urgent" ? "border-pink-700/70" : "border-line")}
    >
      <p className={cn("num text-xl font-semibold tracking-[-0.01em]", tone === "urgent" ? "text-pink-400" : "text-fg-1")}>
        <Money cents={cents} wholeDollars />
      </p>
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="text-xs text-fg-3">{count === 1 ? "1 payment" : `${count} payments`}</p>
    </li>
  );
}

/** The buckets follow the scrubber: measured from the projected date, plus the payments already stale by then. */
function BucketStrip({ scrubbed, offset, asOf }: { scrubbed: ScrubbedBuckets; offset: number; asOf: string }) {
  const showCrossed = offset > 0;
  const from = offset > 0 ? `from ${formatDate(addDays(asOf as IsoDate, offset))}` : "";
  return (
    <ul
      className={cn("grid grid-cols-2 gap-3", showCrossed ? "lg:grid-cols-5" : "lg:grid-cols-4")}
      data-testid="horizon-buckets"
      data-offset={offset}
      aria-label={offset > 0 ? `Amount becoming stale by when, projected ${offset} days forward` : "Amount becoming stale by when"}
    >
      {scrubbed.buckets.map((b) => (
        <Tile key={b.key} cents={b.cents} count={b.count} tone={b.key === "d30" && b.count > 0 ? "urgent" : "plain"} label={`becomes stale ${b.label}${from ? ` ${from}` : ""}`} />
      ))}
      {showCrossed ? <Tile cents={scrubbed.staleByThen.cents} count={scrubbed.staleByThen.count} tone="done" label="already stale by then" /> : null}
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
        Moves the radar dots, the buckets and the worklist. A projection only. The demo clock stays at {formatDate(asOf)}; nothing is saved.
      </p>
    </div>
  );
}

export function HorizonView({ asOf, thresholdDays, items, totalCents, rings, awaitingDetection, ruleStates }: HorizonViewProps) {
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
  const scrubbed = useMemo(() => bucketsAt(items, offset), [items, offset]);
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
      <div className="glass rounded-[18px] p-6 text-sm text-fg-2" data-testid="horizon-empty" data-count={0}>
        No outstanding payments are approaching the {thresholdDays}-day stale line as of {formatDate(asOf)}.
        {awaitingDetection.count > 0 ? ` ${awaitingDetection.count} already crossed it and wait for the next detection run.` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="horizon" data-count={items.length} data-total-cents={totalCents} data-as-of={asOf}>
      <BucketStrip scrubbed={scrubbed} offset={offset} asOf={asOf} />
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
        <div className="min-w-0 overflow-hidden rounded-[14px] border border-line bg-[radial-gradient(ellipse_at_50%_30%,var(--color-ink-2),var(--color-ink-0)_70%)] pt-6 pb-10">
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
        <aside className="space-y-5 glass rounded-[18px] p-4" aria-label="Projection and selected payment">
          <Scrubber offset={offset} onChange={setOffset} asOf={asOf} />
          <div className="border-t border-line pt-4">
            <Readout item={active} offset={offset} asOf={asOf} thresholdDays={thresholdDays} />
          </div>
        </aside>
      </div>

      <Worklist items={items} totalCents={totalCents} activeId={activeId} onActive={setActiveId} offset={offset} asOf={asOf} ruleStates={ruleStates} />
    </div>
  );
}
