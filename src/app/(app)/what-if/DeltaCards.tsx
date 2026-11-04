"use client";

import type { ReactNode } from "react";
import { NumFlow, UnverifiedBadge } from "@/components/primitives";
import type { ProjectionDelta } from "@/lib/what-if/project";
import type { Projection } from "@/lib/what-if/types";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

const USD = { style: "currency", currency: "USD" } as const;

type Tone = "neutral" | "better" | "worse";

/** Up in money or missed deadlines is pink (a human must act); down is blue. */
const toneOf = (n: number): Tone => (n > 0 ? "worse" : n < 0 ? "better" : "neutral");
const TONE_TEXT: Record<Tone, string> = { neutral: "text-fg-3", better: "text-blue-300", worse: "text-pink-400" };

function signedUSD(cents: number): string {
  if (cents === 0) return "no change";
  return `${cents > 0 ? "+" : "−"}${formatUSD(Math.abs(cents))}`;
}

function signedCount(n: number): string {
  return n === 0 ? "no change" : `${n > 0 ? "+" : "−"}${Math.abs(n)}`;
}

type CardProps = {
  title: string;
  testId: string;
  data: Record<string, string | number>;
  value: ReactNode;
  delta: ReactNode;
  foot?: ReactNode;
  alarm?: boolean;
};

function Card({ title, testId, data, value, delta, foot, alarm }: CardProps) {
  const attrs = Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]));
  return (
    <div
      role="group"
      aria-label={title}
      data-testid={testId}
      {...attrs}
      className={cn(
        "relative min-w-0 overflow-hidden rounded-[12px] border bg-ink-2 px-4 pt-3.5 pb-3 shadow-[0_1px_0_0_var(--color-line)_inset]",
        alarm ? "border-pink-700/70" : "border-line",
      )}
    >
      <p className="instrument-label">{title}</p>
      <p className={cn("num mt-1.5 text-[28px] leading-9 font-semibold tracking-[-0.02em] sm:text-[32px]", alarm ? "text-pink-400" : "text-fg-1")}>{value}</p>
      <p className="mt-1 text-[13px]" data-testid={`${testId}-delta`}>
        {delta}
      </p>
      {foot ? <div className="mt-2 border-t border-line pt-2 text-xs text-fg-3">{foot}</div> : null}
    </div>
  );
}

export function DeltaCards({ next, change, atLabel }: { next: Projection; change: ProjectionDelta; atLabel: string }) {
  const exp = next.exposure.cents;
  const interest = next.interest;
  const missed = next.deadlines.missed;
  const unknownStates = interest.unknownStates.join(", ");
  return (
    <div className="grid gap-3 md:grid-cols-3" aria-live="polite">
      <Card
        title={`Open exposure ${atLabel}`}
        testId="wi-exposure"
        data={{ cents: exp, delta: change.exposureCents }}
        value={<NumFlow value={exp / 100} format={USD} label={formatUSD(exp)} />}
        delta={<span className={TONE_TEXT[toneOf(change.exposureCents)]}>{signedUSD(change.exposureCents)} vs today</span>}
        foot={`${next.exposure.count} open, unfiled ${next.exposure.count === 1 ? "item" : "items"}`}
      />
      <Card
        title={`Audit interest ${atLabel}`}
        testId="wi-interest"
        data={{ cents: interest.cents ?? "unknown", known: interest.knownCents }}
        alarm={change.knownInterestCents > 0}
        value={
          interest.cents === null ? (
            <span className="inline-flex items-baseline gap-2">
              <span className="text-fg-2 italic">Unknown</span>
              <span className="sr-only">: no supported interest rule for {unknownStates}</span>
            </span>
          ) : (
            <NumFlow value={interest.cents / 100} format={USD} label={formatUSD(interest.cents)} />
          )
        }
        delta={
          <span className={TONE_TEXT[toneOf(change.knownInterestCents)]}>
            {signedUSD(change.knownInterestCents)} vs today{interest.cents === null ? " (known states)" : ""}
          </span>
        }
        foot={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {interest.cents === null ? (
              <span data-testid="wi-interest-known">
                Known states: <span className="num text-fg-2">{formatUSD(interest.knownCents)}</span>. {unknownStates}: UNKNOWN, not guessed.
              </span>
            ) : (
              <span>From each state&apos;s sourced interest rule.</span>
            )}
            {interest.anyUnverified ? <UnverifiedBadge /> : null}
          </span>
        }
      />
      <Card
        title={`Deadlines missed ${atLabel}`}
        testId="wi-missed"
        data={{ count: missed, delta: change.missed }}
        alarm={missed > 0}
        value={<NumFlow value={missed} label={String(missed)} />}
        delta={<span className={TONE_TEXT[toneOf(change.missed)]}>{signedCount(change.missed)} vs today</span>}
        foot={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {next.deadlines.missedItems} {next.deadlines.missedItems === 1 ? "item" : "items"} late
              {next.deadlines.unknown > 0 ? ` · ${next.deadlines.unknown} with an unknown date (not counted)` : ""}
            </span>
            {next.deadlines.anyUnverified ? <UnverifiedBadge /> : null}
          </span>
        }
      />
    </div>
  );
}
