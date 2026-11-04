import Form from "next/form";
import { Download, FileSearch, ScrollText } from "lucide-react";
import { InstrumentLabel, Money, StatusLabel, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { ProofChain } from "@/components/viz/proof-chain/ProofChain";
import { chainSummary } from "@/components/viz/proof-chain/chain-model";
import { LINK_KINDS, LINK_LABELS } from "@/lib/audit/proof-chain";
import { AUDIT_STATES, SAMPLE_SIZES, type AuditState } from "@/lib/audit/sample";
import { formatDate } from "@/lib/format";
import type { AuditDrill, AuditItem } from "@/lib/queries/audit";
import { cn } from "@/lib/utils";
import { ReadinessGauge } from "./ReadinessGauge";
import { binderHref, STATE_NAMES } from "./params";

const SEGMENT =
  "flex h-9 min-w-[64px] cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-3 text-[13px] text-fg-2 transition-colors duration-150 hover:bg-ink-3 hover:text-fg-1 peer-checked:bg-ink-4 peer-checked:text-fg-1 peer-checked:shadow-[inset_0_0_0_1px_var(--color-blue-700)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-400";

/** The request form. A plain GET (next/form): no server action, nothing is written; the URL is the whole request. */
export function AuditRequestForm({ state, size, all }: { state: AuditState | null; size: number; all: boolean }) {
  const selected = state ?? "DE";
  return (
    <Form action="/audit" className="relative overflow-hidden rounded-[10px] border border-line bg-ink-2" aria-labelledby="audit-request-h">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-blue-500/70 via-blue-500/15 to-transparent" />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-4 pt-3.5 pb-4">
        <div className="min-w-0 basis-full">
          <h2 id="audit-request-h" className="instrument-label">
            Audit request
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-pretty text-fg-2">
            A state examiner asks for a sample of your unclaimed-property file. Draw it the way they would: the same state, demo date and size
            always pick the same items.
          </p>
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs text-fg-3">State</legend>
          <div className="inline-flex gap-1 rounded-[8px] border border-line bg-ink-1 p-1">
            {AUDIT_STATES.map((s) => (
              <label key={s} className="relative">
                <input type="radio" name="state" value={s} defaultChecked={s === selected} className="peer sr-only" data-testid={`audit-state-${s}`} />
                <span className={SEGMENT}>
                  <span className="num font-medium">{s}</span>
                  <span className="hidden text-[12px] text-fg-3 sm:inline">{STATE_NAMES[s]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-3">Sample size</span>
          <select
            name="size"
            defaultValue={String(size)}
            data-testid="audit-size"
            className="h-9 rounded-[6px] border border-line-hover bg-ink-1 px-2.5 text-[13px] text-fg-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {SAMPLE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} items
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-fg-2">
          <input
            type="checkbox"
            name="all"
            value="true"
            defaultChecked={all}
            data-testid="audit-all"
            className="size-4 accent-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          />
          All items
        </label>
        <button type="submit" className={cn(buttonVariants({ size: "lg" }), "sm:ml-auto")} data-testid="audit-simulate">
          <FileSearch aria-hidden strokeWidth={1.75} />
          Simulate audit request
        </button>
      </div>
    </Form>
  );
}

const LEGEND = [
  { label: "Proven", hint: "the record exists", dot: "bg-blue-500 shadow-[0_0_8px_var(--color-blue-500)]" },
  { label: "Missing", hint: "a record is absent; a person must act", dot: "bg-pink-500 shadow-[0_0_8px_var(--color-pink-500)]" },
  { label: "Rules gap", hint: "one state-wide action: verify the rules", dot: "border-2 border-pink-500 bg-ink-1" },
  { label: "Not yet due", hint: "not scored until due", dot: "border border-fg-4 bg-ink-1" },
  { label: "Not required", hint: "left out of the score", dot: "border border-dashed border-line-strong" },
];

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-2" aria-label="Link status key">
      {LEGEND.map((l) => (
        <li key={l.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full", l.dot)} />
          {l.label}
          <span className="text-fg-3">({l.hint})</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "blue" | "pink" | "dim" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className={cn("num mt-0.5 text-[22px] leading-none font-medium tracking-[-0.02em]", tone === "blue" ? "text-blue-300" : tone === "pink" ? "text-pink-400" : "text-fg-2")}>{n}</dd>
    </div>
  );
}

/** "1 action: verify the DE rules" is one action, not one per item; missing records are counted per link. */
function actionsText(drill: AuditDrill): string {
  const { missing, rulesGaps } = drill.score;
  const parts = [
    rulesGaps > 0 ? `1 action: verify the ${drill.state} rules.` : "",
    missing > 0 ? `${missing} ${missing === 1 ? "record is" : "records are"} missing.` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "Every required link that is due is proven.";
}

function Summary({ drill }: { drill: AuditDrill }) {
  const name = STATE_NAMES[drill.state];
  const sample = drill.all ? `all ${drill.populationCount} items` : `${drill.items.length} of ${drill.populationCount} items`;
  return (
    <section aria-labelledby="audit-summary-h" className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-[10px] border border-line bg-ink-2 px-4 pt-5 pb-4">
        <span aria-hidden className="pointer-events-none absolute -top-24 left-1/2 size-56 -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />
        <InstrumentLabel as="p" className="mb-2">
          Readiness
        </InstrumentLabel>
        <ReadinessGauge score={drill.score} />
      </div>
      <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-line bg-ink-2 px-4 pt-3.5 pb-4">
        {drill.score.missing + drill.score.rulesGaps > 0 ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-pink-500/80 via-pink-500/20 to-transparent" /> : null}
        <p className="instrument-label flex items-center gap-1.5">
          <ScrollText className="size-3.5" strokeWidth={1.75} aria-hidden />
          Audit letter · {drill.state} · {formatDate(drill.today)}
        </p>
        <h2 id="audit-summary-h" className="mt-2 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-fg-1">
          {name} asked for {sample}.{" "}
          <span className={drill.score.missing + drill.score.rulesGaps > 0 ? "text-pink-400" : "text-blue-300"}>
            {actionsText(drill)}
          </span>
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat n={drill.score.proven} label="Proven" tone="blue" />
          <Stat n={drill.score.missing} label="Missing" tone="pink" />
          <Stat n={drill.score.rulesGaps} label="Rules gap (state-wide)" tone="pink" />
          <Stat n={drill.score.notYetDue} label="Not yet due" tone="dim" />
          <Stat n={drill.score.notRequired} label="Not required" tone="dim" />
        </dl>
        <dl className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-line pt-3 text-[12px] sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-fg-3">Demo date</dt>
          <dd className="text-fg-2">{formatDate(drill.today)} (demo clock)</dd>
          <dt className="text-fg-3">Seed</dt>
          <dd className="min-w-0 truncate font-mono text-fg-2" title={`sha256(${drill.state}|${drill.today}|${drill.size}) = ${drill.seed}`} data-testid="audit-seed">
            sha256 {drill.seed.slice(0, 16)}…
          </dd>
          <dt className="text-fg-3">Rules</dt>
          <dd className="flex flex-wrap items-center gap-2 text-fg-2">
            {drill.ruleVersion ? `${drill.state} ${drill.ruleVersion}` : "No rule file"}
            {drill.ruleUnverified ? <UnverifiedBadge /> : null}
          </dd>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href={binderHref(drill.state, drill.size, drill.all)} download className={buttonVariants({ variant: "outline" })} data-testid="audit-binder">
            <Download aria-hidden strokeWidth={1.75} />
            Download audit binder (PDF)
          </a>
          <span className="text-xs text-fg-3">A cover page, then one page per sampled item, with sources. Nothing is saved or sent.</span>
        </div>
      </div>
    </section>
  );
}

function ItemCard({ item, index }: { item: AuditItem; index: number }) {
  const label = `${item.payeeName}${item.referenceNumber ? `, ref ${item.referenceNumber}` : ""}`;
  return (
    <li className="min-w-0 rounded-[10px] border border-line bg-ink-1 px-3 pt-3 pb-3 sm:px-4" data-testid="audit-item" data-item-id={item.id}>
      <article aria-labelledby={`audit-item-${item.id}`}>
        <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="num font-mono text-[11px] tracking-[0.08em] text-fg-3">ITEM {String(index + 1).padStart(2, "0")}</span>
          <h3 id={`audit-item-${item.id}`} className="min-w-0 text-[15px] font-medium text-fg-1">
            {item.payeeName}
          </h3>
          {item.referenceNumber ? <span className="font-mono text-[12px] text-fg-3">Ref {item.referenceNumber}</span> : null}
          <Money cents={item.amountCents} className="text-[13px] text-fg-1" />
          <StatusLabel status={item.status} size="sm" />
          <span className="ml-auto text-xs text-fg-3" data-testid="audit-item-score">
            <span className={cn("num text-[13px]", item.score.missing > 0 ? "text-pink-300" : "text-fg-1")}>
              {item.score.proven}/{item.score.required}
            </span>{" "}
            proven{item.score.rulesGapNote ? " · rules: state-wide" : ""} · {chainSummary(item.chain)}
          </span>
        </header>
        <ProofChain links={item.chain} itemLabel={label} animate={index < 6} />
      </article>
    </li>
  );
}

/** Before any request: what the drill checks, as a ghost chain. */
export function AuditIntro() {
  return (
    <section aria-labelledby="audit-intro-h" className="rounded-[10px] border border-dashed border-line px-4 py-5">
      <h2 id="audit-intro-h" className="instrument-label">
        What every sampled item must prove
      </h2>
      <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {LINK_KINDS.map((k, i) => (
          <li key={k} className="flex items-baseline gap-2 rounded-[6px] border border-line bg-ink-1 px-2.5 py-2 lg:flex-col lg:gap-1">
            <span className="num font-mono text-[10px] text-fg-3">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-[12px] text-fg-2">{LINK_LABELS[k]}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[13px] text-fg-3">Pick a state and simulate the request. Nothing is written to the database and nothing is sent.</p>
    </section>
  );
}

export function AuditResults({ drill }: { drill: AuditDrill }) {
  return (
    <div className="space-y-6" data-testid="audit-results" data-seed={drill.seed}>
      <Summary drill={drill} />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="instrument-label">Proof chains · {drill.items.length} sampled</h2>
        <Legend />
      </div>
      {drill.items.length === 0 ? (
        <p className="rounded-[10px] border border-line bg-ink-1 px-4 py-6 text-sm text-fg-2">
          No {drill.state} items on file on {formatDate(drill.today)}, so there is nothing to sample.
        </p>
      ) : (
        <ol className="space-y-4" aria-label="Sampled items">
          {drill.items.map((item, i) => (
            <ItemCard key={item.id} item={item} index={i} />
          ))}
        </ol>
      )}
    </div>
  );
}
