"use client";

import { BookCheck, Bot, Hand, Wrench, Globe, Cog, type LucideIcon } from "lucide-react";
import { formatDuration, safeHttpUrl } from "@/components/b/trace";
import { cn } from "@/lib/utils";
import { ACTOR_LABEL, STAGE_LABEL, type Actor, type TheaterStep } from "@/lib/theater/steps";
import { formatOffset } from "../runs/run-meta";

const ACTOR_ICON: Record<Actor, LucideIcon> = { model: Bot, rules: BookCheck, tool: Wrench, browser: Globe, person: Hand, system: Cog };

/** Model = filled blue; rules engine = outlined blue with its own label; person = pink; everything else neutral. */
export function ActorTag({ actor, className }: { actor: Actor; className?: string }) {
  const Icon = ACTOR_ICON[actor];
  return (
    <span
      data-actor={actor}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[11px] leading-none font-medium",
        actor === "model" && "bg-blue-600 text-fg-1",
        actor === "rules" && "border border-blue-300 text-blue-200",
        actor === "person" && "border border-pink-500 text-pink-300",
        (actor === "tool" || actor === "browser" || actor === "system") && "border border-line-strong text-fg-2",
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={1.75} aria-hidden />
      {ACTOR_LABEL[actor]}
    </span>
  );
}

export function UnverifiedBadge() {
  return (
    <span className="inline-flex h-5 items-center rounded-[4px] border border-pink-500 px-1.5 font-mono text-[10.5px] font-medium tracking-[0.06em] text-pink-300" data-testid="unverified-badge">
      UNVERIFIED
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="min-w-0 text-[13px] break-words text-fg-1">{children}</dd>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function SourceLink({ url, title }: { url: string; title?: string }) {
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="break-all text-blue-300 underline underline-offset-2 hover:text-blue-200" data-testid="step-source">
      {title && title !== hostOf(safe) ? `${title} (${hostOf(safe)})` : safe}
    </a>
  );
}

interface StepDetailProps {
  step: TheaterStep | null;
  position: number;
  total: number;
  live: boolean;
  /** "recorded, not spent" etc. for a replayed or scripted run; null for a live model run. */
  tokenNote?: string | null;
}

/** Everything the stored trace recorded for the current step. Unrecorded fields say so. */
export function StepDetail({ step, position, total, live, tokenNote = null }: StepDetailProps) {
  if (!step) {
    return (
      <div className="glass rounded-[18px] p-4 text-sm text-fg-2" data-testid="step-detail">
        {live ? "The run has started; its first step has not been written yet." : "This run recorded no steps."}
      </div>
    );
  }
  const tone = step.outcome.tone;
  return (
    <div className="glass rounded-[18px] p-4" data-testid="step-detail" aria-live={live ? "polite" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-xs text-fg-3">
          Step {position + 1} of {total}
        </span>
        <span className="text-xs text-fg-3">·</span>
        <span className={cn("text-xs", step.stage === "approval" ? "text-pink-300" : "text-fg-2")}>{STAGE_LABEL[step.stage]}</span>
        <ActorTag actor={step.actor} />
        {step.unverified ? <UnverifiedBadge /> : null}
        {!step.knownKind ? <span className="text-xs text-fg-3">(unrecognized step kind “{step.kind}”, shown as recorded)</span> : null}
      </div>
      <p className="mt-2 text-[15px] leading-6 font-medium break-words text-fg-1">{step.label}</p>
      {step.actor === "rules" ? <p className="mt-1 text-xs text-blue-200">Rules engine: a deterministic lookup in a versioned, sourced rule file. The model never decides the law.</p> : null}
      {step.actor === "model" && step.stage === "rules" ? <p className="mt-1 text-xs text-fg-2">Model research only: anything it found stays UNVERIFIED until a person approves it into the rule file.</p> : null}
      <dl className="mt-2 divide-y divide-line">
        {step.tool ? (
          <Row label="Tool">
            <span className="font-mono text-[12.5px]">{step.tool}</span>
          </Row>
        ) : null}
        <Row label="Inputs">{step.inputs ?? <span className="text-fg-3">Not recorded</span>}</Row>
        <Row label="Outcome">
          {step.outcome.text ? (
            <span className={cn(tone === "error" ? "text-pink-300" : tone === "wait" ? "text-pink-300" : "text-fg-1")}>{step.outcome.text}</span>
          ) : (
            <span className="text-fg-3">Not recorded</span>
          )}
        </Row>
        <Row label="Timing">
          {step.offsetMs != null ? <span className="num">{formatOffset(step.offsetMs)}</span> : <span className="text-fg-3">No timestamp recorded</span>}
          {step.durationMs != null ? <span className="num text-fg-2"> · took {formatDuration(step.durationMs) || "0ms"}</span> : null}
        </Row>
        <Row label="Model">{step.model ? <span className="font-mono text-[12.5px]">{step.model}</span> : <span className="text-fg-3">No model on this step</span>}</Row>
        {step.actor === "model" ? (
          <Row label="Tokens in / out">
            {step.tokens ? (
              <span className="num">
                {step.tokens.input.toLocaleString("en-US")} / {step.tokens.output.toLocaleString("en-US")}
                {tokenNote ? <span className="font-sans text-xs text-fg-2"> ({tokenNote})</span> : null}
              </span>
            ) : (
              <span className="text-fg-3">Not recorded per step (see the run total)</span>
            )}
          </Row>
        ) : null}
        {step.ruleRef ? (
          <Row label="Rule file">
            <span>
              {step.ruleRef.state} @ <span className="font-mono text-[12.5px]">{step.ruleRef.version}</span>
              {step.ruleRef.verified ? <span className="text-fg-2"> · every value verified</span> : <span className="text-pink-300"> · {step.ruleRef.unverifiedCount} unverified values</span>}
            </span>
            {step.ruleRef.sourceUrls.length ? (
              <ul className="mt-1 space-y-0.5">
                {step.ruleRef.sourceUrls.map((u) => (
                  <li key={u}>
                    <span className="text-xs text-fg-3">source_url </span>
                    <SourceLink url={u} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="block text-xs text-fg-3">No source recorded in the rule file</span>
            )}
          </Row>
        ) : step.stage === "rules" && step.actor === "rules" ? (
          <Row label="Rule file">
            <span className="text-fg-3">The step did not record which rule file it read</span>
          </Row>
        ) : null}
        {step.citations.length ? (
          <Row label="Citations">
            <ul className="space-y-0.5">
              {step.citations.map((c) => (
                <li key={c.url}>
                  <SourceLink url={c.url} title={c.title} />
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
      </dl>
    </div>
  );
}

interface StepLogProps {
  steps: readonly TheaterStep[];
  cursor: number;
  /** In a replay, steps after the cursor have not "happened" yet and read quieter. */
  dimFuture: boolean;
  onSelect: (position: number) => void;
}

export function StepLog({ steps, cursor, dimFuture, onSelect }: StepLogProps) {
  if (steps.length === 0) return <p className="text-sm text-fg-3">No steps recorded.</p>;
  return (
    <ol className="space-y-1" data-testid="theater-log">
      {steps.map((s, i) => {
        const current = i === cursor;
        return (
          <li key={`${s.index}-${i}`}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={current ? "step" : undefined}
              data-testid="theater-step"
              data-stage={s.stage}
              data-actor={s.actor}
              className={cn(
                "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-[background-color,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400",
                current ? (s.stage === "approval" ? "border-pink-500 bg-pink-950" : "border-blue-500 bg-blue-950") : "border-transparent hover:border-line hover:bg-ink-2",
              )}
            >
              <span className="num mt-0.5 w-6 shrink-0 text-right text-[11px] text-fg-3">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[13px]", dimFuture && i > cursor ? "text-fg-2" : "text-fg-1")}>{s.label}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={cn("text-[11px]", s.stage === "approval" ? "text-pink-300" : "text-fg-3")}>{STAGE_LABEL[s.stage]}</span>
                  <ActorTag actor={s.actor} />
                  {s.unverified ? <UnverifiedBadge /> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
