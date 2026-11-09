import { CircleCheck, FlaskConical, Info } from "lucide-react";
import { EmptyState, FoldSection, InstrumentLabel, Section } from "@/components/primitives";
import { CopyValue, InView } from "@/components/motion";
import { formatDate } from "@/lib/format";
import { now } from "@/lib/clock";
import { onDemoCalendar } from "@/lib/clock-display";
import { ruleVersionLabel } from "@/lib/rules/version-label";
import { getLatestEvalRun } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import { EvalPercent } from "./EvalPercent";
import { FIELD_KEYS, FIELD_LABEL, describeMethod, errorRows, pct, sliceRows, usesModels, type EvalMethod, type FieldStat, type SliceRow, type SliceStats } from "./eval-model";

/** UI review floor: a slice below this accuracy is flagged in pink. A display threshold, not a stored metric. */
const REVIEW_FLOOR = 0.95;

/** Hatch for the adversarial slice: blue lines on transparent inside a blue-500 outline. */
const HATCH = "repeating-linear-gradient(135deg, var(--color-blue-500) 0 1.5px, transparent 1.5px 4.5px)";
const HATCH_PINK = "repeating-linear-gradient(135deg, var(--color-pink-500) 0 1.5px, transparent 1.5px 4.5px)";

function HowToRun() {
  return (
    <div className="overflow-hidden glass rounded-[18px]">
      <div className="flex h-10 items-center border-b border-line px-4">
        <span className="text-xs text-fg-3">Run a new eval</span>
      </div>
      <div className="px-4 py-3.5">
        <p className="text-[13px] text-fg-2 text-pretty">
          A new run scores all 200 cases and stores the result on this page. It is started from the project&apos;s command line by whoever maintains the demo; with a model key configured it scores the model instead of the heuristic.
        </p>
      </div>
    </div>
  );
}

function MethodBanner({ method }: { method: EvalMethod }) {
  const Icon = method.kind === "model" ? FlaskConical : Info;
  return (
    <div data-testid="eval-method" data-method={method.kind} role="note" className="flex items-start gap-3 rounded-[10px] border border-blue-800/70 bg-blue-900/70 px-4 py-3.5">
      <Icon className="mt-[3px] size-4 shrink-0 text-blue-300" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] text-blue-300">
          Method:{" "}
          <span className="font-medium text-fg-1" data-testid="eval-method-label">
            {method.label}
          </span>
        </p>
        <p className="mt-0.5 max-w-[75ch] text-[13px] text-blue-300/85 text-pretty">{method.detail}</p>
      </div>
    </div>
  );
}

function HeroStat({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 py-4 sm:py-0 sm:pr-8 sm:not-first:border-l sm:not-first:border-line sm:not-first:pl-8", className)}>
      <p className="mb-1.5 text-[13px] text-fg-2">{label}</p>
      {children}
      {hint ? <p className="mt-2 text-[13px] text-fg-3">{hint}</p> : null}
    </div>
  );
}

function Bar({ stat, kind, i }: { stat?: FieldStat; kind: "generated" | "adversarial"; i: number }) {
  const name = kind === "generated" ? "Generated" : "Adversarial";
  if (!stat) {
    return (
      <div className="flex items-center gap-3">
        <span className="h-1.5 flex-1 rounded-full bg-ink-3" aria-hidden />
        <span className="w-[54px] text-right text-[13px] text-fg-3 italic">Unknown</span>
      </div>
    );
  }
  const low = stat.accuracy < REVIEW_FLOOR;
  const label = `${name}: ${pct(stat.accuracy)}, ${stat.correct} of ${stat.total} correct${low ? ", below the review floor" : ""}`;
  return (
    <div className="flex items-center gap-3" title={`${name}: ${stat.correct} of ${stat.total} correct`}>
      <div className="relative h-1.5 flex-1 rounded-full bg-ink-3" role="img" aria-label={label}>
        <div
          className={cn(
            "es-iv-grow-x absolute inset-y-0 left-0 origin-left rounded-full",
            kind === "generated" ? (low ? "bg-pink-500" : "bg-blue-500") : cn("border", low ? "border-pink-500" : "border-blue-500"),
          )}
          style={{
            width: `${Math.max(1, stat.accuracy * 100)}%`,
            backgroundImage: kind === "adversarial" ? (low ? HATCH_PINK : HATCH) : undefined,
            ["--i" as string]: i,
          }}
        />
        <FloorTick />
      </div>
      <span className={cn("num w-[54px] shrink-0 text-right text-[13px]", low ? "font-medium text-pink-400" : "text-fg-1")}>{pct(stat.accuracy)}</span>
    </div>
  );
}

/** The review floor drawn on every track, so "below the floor" is read off the bar, not from a legend. */
function FloorTick() {
  return <span aria-hidden className="absolute -top-[3px] -bottom-[3px] w-px bg-fg-2" style={{ left: `${REVIEW_FLOOR * 100}%` }} />;
}

/** Scale under the field list: where 0, 50%, the floor and 100% sit on every track. */
function Scale() {
  const marks = [
    { at: 0, label: "0%" },
    { at: 0.5, label: "50%" },
    { at: REVIEW_FLOOR, label: `${Math.round(REVIEW_FLOOR * 100)}% floor` },
  ];
  return (
    <div aria-hidden className="grid gap-x-8 pt-2 sm:grid-cols-[200px_minmax(0,1fr)]">
      <span className="max-sm:hidden" />
      <div className="flex items-center gap-3">
        <div className="relative h-4 flex-1 text-[11px] text-fg-3">
          {marks.map((m) => (
            <span
              key={m.label}
              className={cn("absolute top-0 whitespace-nowrap", m.at === 0 ? "left-0" : "-translate-x-full pr-1 sm:-translate-x-1/2 sm:pr-0", m.at === REVIEW_FLOOR && "text-fg-2")}
              style={m.at === 0 ? undefined : { left: `${m.at * 100}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <span className="w-[54px] shrink-0" />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-4 rounded-full bg-blue-500" />
        Generated
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-4 rounded-full border border-blue-500" style={{ backgroundImage: HATCH }} />
        Adversarial
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-4 rounded-full bg-pink-500" />
        Below {Math.round(REVIEW_FLOOR * 100)}%
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-fg-2" />
        Review floor
      </span>
    </p>
  );
}

const SLICE_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * Per-slice accuracy diagram: one track per slice on a shared 0-100% axis with the review floor drawn across all of
 * them, so "which slice is weak" reads off the picture. Generated is solid blue, adversarial hatched, below-floor pink.
 */
function SliceDiagram({ rows }: { rows: SliceRow[] }) {
  return (
    <figure className="m-0" data-testid="eval-slices">
      <InView as="div" className="space-y-4" threshold={0.3}>
        {rows.map((r, i) => {
          const low = r.stat ? r.stat.accuracy < REVIEW_FLOOR : false;
          const hatched = r.key === "adversarial";
          const fill = low ? (hatched ? HATCH_PINK : undefined) : hatched ? HATCH : undefined;
          const label = r.stat ? `${r.label}: ${pct(r.stat.accuracy)}, ${r.stat.correct} of ${r.stat.total} items fully correct${low ? ", below the review floor" : ""}` : `${r.label}: Unknown, no score stored`;
          return (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)_88px] sm:items-center" data-slice={r.key}>
              <div className="min-w-0">
                <InstrumentLabel as="p" className={r.key === "overall" ? "text-fg-2" : undefined}>
                  {r.label}
                </InstrumentLabel>
                <p className="mt-0.5 text-xs text-fg-3">{r.stat ? `${r.stat.correct} of ${r.stat.total} items` : "No score stored"}</p>
              </div>
              <p className={cn("num text-right text-[15px] font-medium sm:order-last", low ? "text-pink-400" : r.stat ? "text-fg-1" : "text-fg-3 italic")}>
                {r.stat ? pct(r.stat.accuracy) : "Unknown"}
              </p>
              <div className="relative col-span-2 h-3 rounded-[3px] bg-ink-3 sm:col-span-1" role="img" aria-label={label}>
                {SLICE_TICKS.slice(1, -1).map((t) => (
                  <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: `${t * 100}%` }} />
                ))}
                {r.stat ? (
                  <span
                    aria-hidden
                    className={cn(
                      "es-iv-grow-x absolute inset-y-0 left-0 origin-left rounded-[3px]",
                      hatched ? cn("border", low ? "border-pink-500" : "border-blue-500") : low ? "bg-pink-500" : r.key === "overall" ? "bg-blue-300" : "bg-blue-500",
                    )}
                    style={{ width: `${Math.max(1, r.stat.accuracy * 100)}%`, backgroundImage: fill, ["--i" as string]: i }}
                  />
                ) : (
                  <span aria-hidden className="absolute inset-0 rounded-[3px] border border-dashed border-fg-4" />
                )}
                <span aria-hidden className="absolute -top-1 -bottom-1 w-px bg-fg-2" style={{ left: `${REVIEW_FLOOR * 100}%` }} />
              </div>
            </div>
          );
        })}
      </InView>
      <div aria-hidden className="mt-2 grid gap-x-4 sm:grid-cols-[150px_minmax(0,1fr)_88px]">
        <span className="max-sm:hidden" />
        <div className="relative h-4 font-mono text-[10.5px] text-fg-3">
          {SLICE_TICKS.map((t) => (
            <span key={t} className={cn("absolute top-0", t === 0 ? "left-0" : t === 1 ? "right-0" : "-translate-x-1/2")} style={t === 0 || t === 1 ? undefined : { left: `${t * 100}%` }}>
              {Math.round(t * 100)}%
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-fg-3">
        Share of items with every field correct, per slice. The vertical line is the {Math.round(REVIEW_FLOOR * 100)}% review floor; a dashed track means the run stored
        no score for that slice.
      </figcaption>
    </figure>
  );
}

const show = (v: unknown) => (v === undefined ? "none" : typeof v === "string" ? v : JSON.stringify(v));

export async function EvalView() {
  const { db, companyId } = await getCtx();
  const demoToday = await now(db, companyId);
  const latest = await getLatestEvalRun(db);
  if (!latest) {
    return (
      <div className="space-y-6">
        <div className="border-t border-line">
          <EmptyState title="No eval run yet" description="Nothing is shown here until a run has been stored, so no accuracy number is ever made up." />
        </div>
        <HowToRun />
      </div>
    );
  }
  const { run, results } = latest;
  const metrics = (run.metrics ?? {}) as {
    mode?: string;
    overall?: SliceStats;
    bySlice?: Record<string, SliceStats>;
    methodCounts?: Record<string, number>;
    anchor?: string;
    threshold?: number;
    holderState?: string;
    failed?: number;
  };
  const method = describeMethod(metrics.mode, run.workerModel, run.orchestratorModel);
  const overall = metrics.overall ?? {};
  const gen = metrics.bySlice?.generated ?? {};
  const adv = metrics.bySlice?.adversarial ?? {};
  const errors = errorRows(results.map((r) => ({ pass: r.pass, slice: r.slice, itemSnapshot: r.itemSnapshot, expected: r.expected, actual: r.actual })));
  const total = overall.all_fields?.total;
  const genAll = gen.all_fields;
  const advAll = adv.all_fields;
  // F35: a heuristic (or unrecorded) run used no model, so it lists none.
  const modelRows: [string, React.ReactNode, boolean?][] = usesModels(method)
    ? [
        ["Worker model", run.workerModel, true],
        ["Orchestrator model", run.orchestratorModel, true],
      ]
    : [["Models", "None used (no model classified these items)"]];
  const details: [string, React.ReactNode, boolean?][] = [
    ["Method", method.label],
    ...modelRows,
    ["Stale as of", metrics.anchor ? formatDate(metrics.anchor) : "Unknown"],
    ["Stale threshold", metrics.threshold != null ? `${metrics.threshold} days` : "Unknown"],
    ["Holder state assumed", metrics.holderState ?? "Unknown"],
    [
      "Rule versions",
      run.ruleVersions && Object.keys(run.ruleVersions).length
        ? Object.entries(run.ruleVersions)
            .map(([k, v]) => ruleVersionLabel(v, k))
            .join(", ")
        : "Not recorded for this run",
      Boolean(run.ruleVersions && Object.keys(run.ruleVersions).length),
    ],
    ["Classifier failures", metrics.failed != null ? String(metrics.failed) : "Unknown"],
  ];

  return (
    <div className="space-y-10">
      <MethodBanner method={method} />

      <div className="grid grid-cols-2 border-t border-line sm:flex sm:flex-wrap sm:pt-6">
        <HeroStat
          label="Items fully correct"
          hint={overall.all_fields ? `${overall.all_fields.correct} of ${overall.all_fields.total} items` : "No score stored"}
          className="col-span-2 border-b border-line sm:border-b-0"
        >
          {overall.all_fields ? (
            <EvalPercent value={overall.all_fields.accuracy} testId="eval-overall" className="num block text-[clamp(2.75rem,1.6rem+3.6vw,4rem)] leading-none font-medium tracking-[-0.04em] text-fg-1" />
          ) : (
            <p data-testid="eval-overall" className="text-[28px] leading-none text-fg-3 italic">
              Unknown
            </p>
          )}
        </HeroStat>
        <HeroStat label="Generated" hint={genAll ? `${genAll.correct} of ${genAll.total} items` : "No score stored"}>
          {genAll ? <EvalPercent value={genAll.accuracy} className="num block text-[28px] leading-none font-medium tracking-[-0.02em] text-fg-1" /> : <p className="text-xl text-fg-3 italic">Unknown</p>}
        </HeroStat>
        <HeroStat label="Adversarial" hint={advAll ? `${advAll.correct} of ${advAll.total} edge cases${advAll.accuracy < REVIEW_FLOOR ? `, below ${Math.round(REVIEW_FLOOR * 100)}%` : ""}` : "No score stored"}>
          {advAll ? (
            <EvalPercent
              value={advAll.accuracy}
              className={cn("num block text-[28px] leading-none font-medium tracking-[-0.02em]", advAll.accuracy < REVIEW_FLOOR ? "text-pink-400" : "text-fg-1")}
            />
          ) : (
            <p className="text-xl text-fg-3 italic">Unknown</p>
          )}
        </HeroStat>
        <HeroStat label="Run date" hint={`${total ?? "Unknown"} cases scored`} className="col-span-2 border-t border-line sm:border-t-0">
          <p className="num text-[28px] leading-none font-medium tracking-[-0.02em] text-fg-1">{formatDate(onDemoCalendar(run.runAt.toISOString(), demoToday))}</p>
        </HeroStat>
      </div>

      <Section id="by-slice" title="Accuracy by slice">
        <SliceDiagram rows={sliceRows(metrics.overall, metrics.bySlice)} />
      </Section>

      <Section id="slices" title="Accuracy by field">
        <Legend />
        <InView as="dl" className="divide-y divide-line" threshold={0.3}>
          {FIELD_KEYS.map((f, i) => (
            <div key={f} className="grid gap-x-8 gap-y-2.5 py-4 first:pt-1 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center">
              <dt>
                <span className="block text-sm text-fg-1">{FIELD_LABEL[f]}</span>
                <span className="mt-0.5 block text-xs text-fg-3">
                  {overall[f] ? (
                    <>
                      <span className="num">{pct(overall[f]!.accuracy)}</span> of all {overall[f]!.total}
                    </>
                  ) : (
                    "No overall score"
                  )}
                </span>
              </dt>
              <dd className="space-y-2">
                <Bar stat={gen[f]} kind="generated" i={i * 2} />
                <Bar stat={adv[f]} kind="adversarial" i={i * 2 + 1} />
              </dd>
            </div>
          ))}
        </InView>
        <Scale />
        <p className="mt-2 text-xs text-fg-3">Adversarial cases are hand-written messy addresses. Exact counts are in each bar&rsquo;s tooltip.</p>
      </Section>

      <Section id="errors" title="Misses" meta={<span className="num">{errors.length}</span>}>
        {errors.length === 0 ? (
          <div className="flex items-start gap-2.5 py-2">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-blue-500" strokeWidth={1.75} aria-hidden />
            <EmptyState title="No misses in this run" description="Every field of every case matched its label." className="py-0" />
          </div>
        ) : (
          <div>
            <div className="hidden h-9 grid-cols-[96px_112px_140px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 text-xs text-fg-3 shadow-[inset_0_-1px_0_var(--color-line)] sm:grid" aria-hidden>
              <span>Case</span>
              <span>Slice</span>
              <span>Field</span>
              <span>Expected</span>
              <span>Got</span>
            </div>
            <ul>
              {errors.map((e) => (
                <li
                  key={`${e.caseId}-${e.field}`}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-line py-2.5 text-[13px] sm:grid-cols-[96px_112px_140px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
                >
                  <span className="min-w-0">
                    <CopyValue value={e.caseId} label="case id" className="text-fg-1" />
                  </span>
                  <span className="text-right text-fg-3 sm:text-left">{e.slice === "adversarial" ? "Adversarial" : "Generated"}</span>
                  <span className="col-span-2 text-fg-2 sm:col-span-1">{FIELD_LABEL[e.field]}</span>
                  <span className="col-span-2 min-w-0 break-words sm:col-span-1">
                    <span className="mr-1.5 inline-block w-14 text-xs text-fg-3 sm:sr-only">Expected</span>
                    <span className="font-mono text-xs text-fg-1">{show(e.expected)}</span>
                  </span>
                  <span className="col-span-2 min-w-0 break-words sm:col-span-1">
                    <span className="mr-1.5 inline-block w-14 text-xs text-fg-3 sm:sr-only">Got</span>
                    <span className="font-mono text-xs text-pink-400">{show(e.actual)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <FoldSection id="meta" title="Run details" testId="eval-run-details">
        <dl className="grid gap-x-10 sm:grid-cols-2">
          {details.map(([k, v, mono]) => (
            <div key={k} className="grid grid-cols-[132px_minmax(0,1fr)] gap-x-4 border-b border-line py-2.5 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
              <dt className="text-fg-3">{k}</dt>
              <dd className={cn("min-w-0 break-words text-fg-1", mono && "font-mono text-xs leading-5")}>{v}</dd>
            </div>
          ))}
        </dl>
      </FoldSection>

      <HowToRun />
    </div>
  );
}
