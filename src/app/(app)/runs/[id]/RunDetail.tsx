import Link from "next/link";
import { ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import { JsonView } from "@/components/b/JsonView";
import { collectCitations, formatCostMicros, formatDuration, normalizeTrace } from "@/components/b/trace";
import { PageHeader, Section } from "@/components/primitives";
import type { AgentRun } from "@/db/schema";
import { RunStatus } from "../RunStatus";
import { absoluteTime, agentLabel, isScripted, runTask } from "../run-meta";
import { LiveRefresh } from "./LiveRefresh";
import { StepViewer } from "./StepViewer";

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0 py-3 sm:py-0 sm:pr-6 sm:not-first:border-l sm:not-first:border-line sm:not-first:pl-6">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="mt-1 truncate text-sm text-fg-1" title={title}>
        {children}
      </dd>
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-fg-3">{children}</span>;

export function RunDetail({ run }: { run: AgentRun }) {
  const steps = normalizeTrace(run.trace, run.finishedAt);
  const citations = collectCitations(run.trace, run.output);
  const dur = run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;
  const scripted = isScripted(run.input, run.model);
  const phase = (run.output as Record<string, unknown> | null)?.phase;
  const gate = phase === "awaiting_approval" || steps.some((s) => s.kind === "paused" || s.kind === "approval");
  const hasTokens = run.inputTokens != null || run.outputTokens != null;
  const shots = steps.filter((s) => s.screenshot).length;
  const live = run.status === "running";

  return (
    <div>
      {live ? <LiveRefresh /> : null}
      <PageHeader title={agentLabel(run.agent)} description={runTask(run.agent, run.input) ?? undefined} actions={<RunStatus status={run.status} className="text-sm" />} className="mb-6" />

      <dl className="grid grid-cols-2 gap-x-6 border-y border-line py-1 sm:flex sm:flex-wrap sm:gap-y-4 sm:py-4">
        <Stat label="Duration">{dur != null ? <span className="num">{formatDuration(dur)}</span> : <span className="text-blue-300">Running</span>}</Stat>
        <Stat label="Steps">
          <span className="num">{steps.length}</span>
        </Stat>
        <Stat label="Model" title={run.model ?? undefined}>
          {scripted ? <Muted>Scripted mode</Muted> : run.model ? <span className="font-mono text-[13px]">{run.model}</span> : <Muted>Not recorded</Muted>}
        </Stat>
        <Stat label="Tokens in / out">
          {hasTokens ? (
            <span className="num">
              {(run.inputTokens ?? 0).toLocaleString("en-US")} <span className="text-fg-3">/</span> {(run.outputTokens ?? 0).toLocaleString("en-US")}
            </span>
          ) : (
            <Muted>—</Muted>
          )}
        </Stat>
        <Stat label="Cost">{run.costUsdMicros != null ? <span className="num">{formatCostMicros(run.costUsdMicros)}</span> : <Muted>—</Muted>}</Stat>
        <Stat label="Started" title={absoluteTime(run.startedAt)}>
          <time dateTime={run.startedAt.toISOString()} className="num">
            {run.startedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC
          </time>
        </Stat>
      </dl>

      {scripted ? (
        <p role="note" className="mt-4 flex items-start gap-2.5 rounded-lg border border-blue-800/70 bg-blue-900/70 px-3.5 py-2.5 text-[13px] text-blue-300">
          <Info className="mt-[3px] size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>Scripted run: no model key is configured, so the portal steps were replayed deterministically and labeled as such. No tokens were used and nothing was billed.</span>
        </p>
      ) : null}

      {run.error ? (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-[10px] border border-pink-500/60 bg-pink-900/40 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-1">This run failed</p>
            <p className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-fg-2">{run.error}</p>
          </div>
        </div>
      ) : null}
      {gate && live ? (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-pink-700 bg-pink-900/60 px-4 py-3 text-sm text-fg-1">
          <span aria-hidden className="es-pulse size-2 rounded-full bg-pink-500" />
          Paused at an approval gate.
          <Link href="/approvals" className="inline-flex items-center gap-1 text-pink-300 underline underline-offset-2 hover:text-pink-300/80">
            Review in Approvals <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      ) : null}

      <Section
        id="trace"
        title="Trace"
        meta={
          <>
            <span className="num">{steps.length}</span> steps{shots ? (
              <>
                , <span className="num">{shots}</span> screenshots
              </>
            ) : null}
            {live ? <span className="ml-2 text-blue-300">streaming</span> : null}
          </>
        }
        className="mt-8"
      >
        <StepViewer runId={run.id} steps={steps} startedAt={run.startedAt.toISOString()} live={live} />
      </Section>

      <Section id="io" title="Input and output" className="mt-10">
        <div className="grid gap-4 lg:grid-cols-2">
          <JsonView label="Input" value={run.input} defaultOpen={false} />
          <JsonView label="Output" value={run.output} defaultOpen={false} />
        </div>
      </Section>

      {citations.length > 0 ? (
        <Section id="cit" title="Citations" meta={<span className="num">{citations.length}</span>} className="mt-10">
          <ul className="space-y-4">
            {citations.map((c) => (
              <li key={c.url} className="text-sm">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1 font-medium text-blue-300 underline-offset-2 hover:underline">
                  {c.title}
                  <ArrowUpRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-px group-hover:-translate-y-px" strokeWidth={1.5} aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                {c.quote ? <p className="mt-1 max-w-[80ch] text-fg-2 text-pretty">&ldquo;{c.quote.slice(0, 320)}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
