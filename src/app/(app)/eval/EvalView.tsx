import { CircleAlert, FlaskConical, Terminal } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { CopyButton } from "@/components/b/CopyButton";
import { formatDate } from "@/lib/format";
import { getLatestEvalRun } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import {
  FIELD_KEYS,
  FIELD_LABEL,
  describeMethod,
  errorRows,
  pct,
  type EvalMethod,
  type FieldStat,
  type SliceStats,
} from "./eval-model";

function HowToRun() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-sunken px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <code className="font-mono text-sm">pnpm eval</code>
        <span className="text-sm text-muted-foreground">runs the 200 cases and stores a new run. Set ANTHROPIC_API_KEY to score the model instead of the heuristic.</span>
      </div>
      <CopyButton value="pnpm eval" />
    </div>
  );
}

function MethodBanner({ method }: { method: EvalMethod }) {
  const loud = method.kind !== "model";
  return (
    <div
      data-testid="eval-method"
      data-method={method.kind}
      className={cn("flex items-start gap-3.5 rounded-[14px] border p-4 sm:p-5", loud ? "border-line-strong bg-ink-3" : "border-blue-800 bg-blue-900/60")}
    >
      {loud ? <CircleAlert className="mt-0.5 size-5 shrink-0 text-fg-2" aria-hidden /> : <FlaskConical className="mt-0.5 size-5 shrink-0 text-blue-300" aria-hidden />}
      <div className="min-w-0">
        <p className="text-xs text-fg-3">Classification method</p>
        <p className={cn("mt-0.5 text-xl leading-7 font-semibold", loud ? "text-fg-1" : "text-blue-300")} data-testid="eval-method-label">
          {method.label}
        </p>
        <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{method.detail}</p>
      </div>
    </div>
  );
}

function Bar({ stat, tone }: { stat?: FieldStat; tone: "slate" | "sky" }) {
  if (!stat) return <span className="text-sm text-muted-foreground italic">Unknown</span>;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${pct(stat.accuracy)} accurate, ${stat.correct} of ${stat.total}`}>
        <div className={cn("h-full origin-left rounded-full", tone === "sky" ? "bg-blue-300" : "bg-blue-500")} style={{ width: "100%", transform: `scaleX(${stat.accuracy})` }} />
      </div>
      <span className="w-[5.5ch] shrink-0 text-right font-mono text-sm tabular-nums">{pct(stat.accuracy)}</span>
      <span className="hidden w-[9ch] shrink-0 font-mono text-xs text-muted-foreground tabular-nums sm:inline">
        {stat.correct}/{stat.total}
      </span>
    </div>
  );
}

const show = (v: unknown) => (v === undefined ? "none" : typeof v === "string" ? v : JSON.stringify(v));

export async function EvalView() {
  const { db } = await getCtx();
  const latest = await getLatestEvalRun(db);
  if (!latest) {
    return (
      <div className="space-y-4">
        <div className="rounded-[14px] border border-border bg-surface p-6">
          <EmptyState title="No eval run yet" description="Nothing is shown here until a run has been stored, so no accuracy number is ever made up." />
        </div>
        <HowToRun />
      </div>
    );
  }
  const { run, results } = latest;
  const metrics = (run.metrics ?? {}) as { mode?: string; overall?: SliceStats; bySlice?: Record<string, SliceStats>; methodCounts?: Record<string, number>; anchor?: string; threshold?: number; holderState?: string; failed?: number };
  const method = describeMethod(metrics.mode, run.workerModel, run.orchestratorModel);
  const overall = metrics.overall ?? {};
  const gen = metrics.bySlice?.generated ?? {};
  const adv = metrics.bySlice?.adversarial ?? {};
  const errors = errorRows(results.map((r) => ({ pass: r.pass, slice: r.slice, itemSnapshot: r.itemSnapshot, expected: r.expected, actual: r.actual })));
  const total = overall.all_fields?.total;

  return (
    <div className="space-y-5">
      <MethodBanner method={method} />

      <div className="grid gap-x-6 gap-y-5 rounded-[16px] border border-strong bg-surface p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="mb-1.5 text-xs text-fg-3">Items fully correct</p>
          <p className="font-mono text-[clamp(2.5rem,1.4rem+3.5vw,3.5rem)] leading-none font-semibold tracking-[-0.02em] tabular-nums" data-testid="eval-overall">
            {overall.all_fields ? pct(overall.all_fields.accuracy) : "Unknown"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{overall.all_fields ? `${overall.all_fields.correct} of ${overall.all_fields.total} items` : "No score stored"}</p>
        </div>
        {[
          ["Generated slice", gen, "items, all four fields"],
          ["Adversarial slice", adv, "hand-written edge cases"],
        ].map(([label, st, hint]) => {
          const a = (st as SliceStats).all_fields;
          return (
            <div key={label as string}>
              <p className="mb-1.5 text-xs text-fg-3">{label as string}</p>
              <p className="font-mono text-3xl leading-none font-semibold tabular-nums">{a ? pct(a.accuracy) : "Unknown"}</p>
              <p className="mt-2 text-sm text-muted-foreground">{a ? `${a.correct}/${a.total} ${hint}` : "No score stored"}</p>
            </div>
          );
        })}
        <div>
          <p className="mb-1.5 text-xs text-fg-3">Run</p>
          <p className="font-mono text-2xl leading-8 font-semibold">{formatDate(run.runAt.toISOString().slice(0, 10))}</p>
          <p className="mt-2 text-sm text-muted-foreground">{total ?? "Unknown"} cases scored</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="fields-h" className="rounded-[14px] border border-border bg-surface p-5">
          <h2 id="fields-h" className="text-[15px] font-semibold">Accuracy by field</h2>
          <p className="mt-0.5 mb-4 text-sm text-muted-foreground">All {total ?? ""} cases.</p>
          <dl className="space-y-4">
            {FIELD_KEYS.map((f) => (
              <div key={f}>
                <dt className="mb-1.5 text-sm">{FIELD_LABEL[f]}</dt>
                <dd>
                  <Bar stat={overall[f]} tone="slate" />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="slice-h" className="rounded-[10px] border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="slice-h" className="text-[15px] font-semibold">Generated vs adversarial</h2>
            <p className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-blue-500" />Generated</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-blue-300" />Adversarial</span>
            </p>
          </div>
          <p className="mt-0.5 mb-4 text-sm text-muted-foreground">Adversarial cases are hand-written messy addresses.</p>
          <dl className="space-y-4">
            {FIELD_KEYS.map((f) => (
              <div key={f}>
                <dt className="mb-1.5 text-sm">{FIELD_LABEL[f]}</dt>
                <dd className="space-y-1.5">
                  <Bar stat={gen[f]} tone="slate" />
                  <Bar stat={adv[f]} tone="sky" />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section aria-labelledby="errors-h" className="rounded-[14px] border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
          <h2 id="errors-h" className="text-[15px] font-semibold">
            Misses <span className="ml-1 font-mono text-sm text-muted-foreground">{errors.length}</span>
          </h2>
        </div>
        {errors.length === 0 ? (
          <EmptyState title="No misses in this run" description="Every field of every case matched its label." className="px-5" />
        ) : (
          <div className="overflow-x-auto px-2 pt-2 pb-3">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Case</th>
                  <th scope="col" className="px-3 py-2 font-medium">Slice</th>
                  <th scope="col" className="px-3 py-2 font-medium">Field</th>
                  <th scope="col" className="px-3 py-2 font-medium">Expected</th>
                  <th scope="col" className="px-3 py-2 font-medium">Got</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={`${e.caseId}-${e.field}`} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{e.caseId}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.slice === "adversarial" ? "Adversarial" : "Generated"}</td>
                    <td className="px-3 py-2">{FIELD_LABEL[e.field]}</td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-1">{show(e.expected)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-pink-400">{show(e.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="meta-h" className="rounded-[14px] border border-border bg-surface p-5">
        <h2 id="meta-h" className="mb-3 text-[15px] font-semibold">Run details</h2>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Method", method.label],
            ["Worker model", run.workerModel],
            ["Orchestrator model", run.orchestratorModel],
            ["Stale as of", metrics.anchor ?? "Unknown"],
            ["Stale threshold", metrics.threshold != null ? `${metrics.threshold} days` : "Unknown"],
            ["Holder state assumed", metrics.holderState ?? "Unknown"],
            ["Rule versions", run.ruleVersions && Object.keys(run.ruleVersions).length ? Object.entries(run.ruleVersions).map(([k, v]) => `${k}@${v}`).join(", ") : "Not recorded for this run"],
            ["Classifier failures", metrics.failed != null ? String(metrics.failed) : "Unknown"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-fg-3">{k}</dt>
              <dd className="mt-1 font-mono text-[13px] break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <HowToRun />
    </div>
  );
}
