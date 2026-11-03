import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { UnverifiedBadge } from "@/components/primitives/badges";
import { SourceChain } from "@/components/viz/core/SourceChain";
import { ruleFieldLabel } from "@/lib/rules/derivation";
import { cn } from "@/lib/utils";
import { buildWhy, type WhyInput } from "./why-model";

export interface WhyThisDateProps {
  node: WhyInput;
  className?: string;
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** One layer of the provenance chain: an instrument label, the content, and the rail that connects it to the next. */
function Layer({ label, last, children, testId }: { label: string; last?: boolean; children: ReactNode; testId: string }) {
  return (
    <li className="relative grid grid-cols-[12px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0" data-testid={testId}>
      {!last ? <span aria-hidden className="absolute top-3 bottom-0 left-[5.5px] w-px bg-blue-500/40" /> : null}
      <span aria-hidden className="relative mt-[3px] size-3 rounded-full border border-blue-400 bg-ink-1" />
      <div className="min-w-0">
        <p className="instrument-label mb-1">{label}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * "Why this date?" for one item date (DESIGN-V3 §4.4, local to slice 3): how the engine derived it, the value, the rule
 * values it used, the sources behind them, and whether a person has verified them. Built on SourceChain. The LLM is not
 * involved: every line is the rules engine's derivation text.
 */
export function WhyThisDate({ node, className }: WhyThisDateProps) {
  const m = buildWhy(node);
  const firstRule = m.rules[0]?.path ?? null;
  return (
    <div className={cn("rounded-[10px] border border-line bg-ink-2 p-4", className)} data-testid="why-this-date" data-key={m.key}>
      <ol aria-label={`Why ${m.label.toLowerCase()} is ${m.date ? fmtDate(m.date) : "unknown"}`}>
        {m.steps.length > 0 ? (
          <Layer label="Derivation" testId="why-step">
            <ol className="space-y-0.5 text-xs leading-5 text-pretty text-fg-2">
              {m.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {m.roll ? (
              <p className="mt-1 text-xs text-fg-2">
                <span className="font-medium text-fg-1">Business-day roll. </span>
                {m.roll}
              </p>
            ) : null}
          </Layer>
        ) : null}
        <Layer label={m.label} testId="why-value">
          {m.date ? (
            <SourceChain
              value={<span className="num text-base font-medium">{fmtDate(m.date)}</span>}
              rulePath={firstRule}
              sources={[]}
              verified={m.verification === "unverified" ? false : undefined}
            />
          ) : (
            <p className="text-[13px] text-fg-3 italic">Unknown. {m.unknownReason}</p>
          )}
        </Layer>
        {m.rules.length > 0 ? (
          <Layer label="Rule values used" testId="why-rules">
            <ul className="space-y-1">
              {m.rules.map((r) => (
                <li key={r.path} className="min-w-0 text-xs">
                  <span className="text-fg-2">{ruleFieldLabel(r.path)}</span>
                  <code className="ml-1.5 font-mono text-[11px] break-all text-fg-3">{r.path}</code>
                </li>
              ))}
            </ul>
            {m.rules[0]?.version ? (
              <p className="mt-1 text-xs text-fg-3">
                Rule file <span className="font-mono text-[11px]">{m.rules[0].version}</span>
              </p>
            ) : null}
          </Layer>
        ) : null}
        {m.sources.length > 0 ? (
          <Layer label="Sources" testId="why-sources">
            <ul className="space-y-1.5">
              {m.sources.map((s) => (
                <li key={s.url} className="min-w-0">
                  <SourceChain value={<span className="text-xs text-fg-3">Cited</span>} sources={[{ url: s.url, title: s.title, quote: s.quote }]} className="text-xs" />
                  {s.quote ? <blockquote className="mt-0.5 border-l border-line-hover pl-2 text-xs text-pretty text-fg-3">“{s.quote}”</blockquote> : null}
                </li>
              ))}
            </ul>
          </Layer>
        ) : null}
        <Layer label="Verification" testId="why-verification" last>
          {m.verification === "unverified" ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
              <UnverifiedBadge />
              Nobody has verified these rule values yet. This date is provisional until a person checks them in Rules.
            </p>
          ) : m.verification === "verified" ? (
            <p className="flex items-center gap-2 text-xs text-fg-2">
              <ShieldCheck className="size-3.5 text-blue-400" strokeWidth={1.75} aria-hidden />
              The rule values behind this date are marked verified.
            </p>
          ) : (
            <p className="text-xs text-fg-2">A fact from your ledger, not a legal rule. Nothing to verify.</p>
          )}
        </Layer>
      </ol>
    </div>
  );
}
