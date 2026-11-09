import Link from "next/link";
import { ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import { JsonView } from "@/components/b/JsonView";
import { collectCitations, formatCostMicros, formatDuration, normalizeTrace } from "@/components/b/trace";
import { InstrumentLabel, PageHeader, Section } from "@/components/primitives";
import type { AgentRun } from "@/db/schema";
import { RunStatus } from "../RunStatus";
import { absoluteTime, agentLabel, costCell, displayRunStatus, gateHref, isOfflineAnswer, isReplay, isScripted, isSkippedReplay, runDurationMs, runTask } from "../run-meta";
import { LiveRefresh } from "./LiveRefresh";
import { StepViewer } from "./StepViewer";
import { cleanTrace, runVideo } from "./trace-view";

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0 py-3 sm:py-0 sm:pr-6 sm:not-first:border-l sm:not-first:border-line sm:not-first:pl-6">
      <dt>
        <InstrumentLabel>{label}</InstrumentLabel>
      </dt>
      <dd className="mt-1 truncate text-sm text-fg-1" title={title}>
        {children}
      </dd>
    </div>
  );
}

/** How the run was driven, said once in the header: live model, scripted (no key) or an offline replay. */
function ModeLabel({ scripted, replay, live }: { scripted: boolean; replay: boolean; live: boolean }) {
  const text = scripted ? "Scripted (no model)" : replay ? "Offline replay" : live ? "Live" : "Model run";
  return (
    <span data-testid="run-mode" className="inline-flex h-6 items-center rounded-[4px] border border-line-strong px-2 font-mono text-[10.5px] font-medium tracking-[0.08em] text-fg-2 uppercase">
      {text}
    </span>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-fg-3">{children}</span>;

export function RunDetail({ run, reportState = null }: { run: AgentRun; reportState?: string | null }) {
  const { steps, hidden: hiddenNoise } = cleanTrace(normalizeTrace(run.trace, run.finishedAt));
  const video = runVideo(run.output) ? `/runs/${run.id}/video` : null;
  const endAt = (run.finishedAt ?? new Date()).toISOString();
  const gateLink = gateHref(run.agent, run.input, reportState);
  const citations = collectCitations(run.trace, run.output);
  const dur = runDurationMs(run.startedAt, run.finishedAt);
  const scripted = isScripted(run.input, run.model);
  const replay = isReplay(run.input);
  const cost = costCell(run);
  const phase = (run.output as Record<string, unknown> | null)?.phase;
  const gate = phase === "awaiting_approval" || steps.some((s) => s.kind === "paused" || s.kind === "approval");
  const hasTokens = run.inputTokens != null || run.outputTokens != null;
  const shots = steps.filter((s) => s.screenshot).length;
  const live = run.status === "running";

  return (
    <div>
      {live ? <LiveRefresh /> : null}
      <PageHeader
        title={agentLabel(run.agent)}
        description={runTask(run.agent, run.input) ?? undefined}
        actions={
          <span className="flex flex-wrap items-center gap-3">
            <Link
              href={`/theater?run=${run.id}`}
              className="inline-flex h-7 items-center rounded-md border border-blue-500 px-2.5 text-[13px] font-medium text-blue-200 transition-colors duration-150 hover:bg-blue-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              data-testid="run-watch-link"
            >
              Watch it work
            </Link>
            <ModeLabel scripted={scripted} replay={replay} live={live} />
            <RunStatus status={displayRunStatus(run.agent, run.status, run.input)} className="text-sm" />
          </span>
        }
        className="mb-6"
      />

      <dl className="grid grid-cols-2 gap-x-6 border-y border-line py-1 sm:flex sm:flex-wrap sm:gap-y-4 sm:py-4">
        <Stat label="Duration">{dur != null ? <span className="num">{formatDuration(dur)}</span> : <span className="text-blue-300">Running</span>}</Stat>
        <Stat label="Steps">
          <span className="num">{steps.length}</span>
        </Stat>
        <Stat label="Model" title={run.model ?? undefined}>
          {scripted ? <Muted>Scripted mode</Muted> : replay ? <span>{isOfflineAnswer(run.trace) ? "Offline answer (no model)" : "Replay (offline)"}</span> : run.model ? <span className="font-mono text-[13px]">{run.model}</span> : <Muted>Not recorded</Muted>}
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
        <Stat label="Cost">{cost.kind === "not_billed" ? <Muted>Not billed ({replay ? "replay" : "scripted"})</Muted> : cost.kind === "cost" && cost.micros != null ? <span className="num">{formatCostMicros(cost.micros)}</span> : <Muted>—</Muted>}</Stat>
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

      {replay ? (
        <p role="note" className="mt-4 flex items-start gap-2.5 rounded-lg border border-blue-800/70 bg-blue-900/70 px-3.5 py-2.5 text-[13px] text-blue-300">
          <Info className="mt-[3px] size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            {isSkippedReplay(run.status, run.input)
              ? "Offline replay with no recorded answer: no model was called, nothing was billed, and nothing failed. The app used its deterministic fallback."
              : "Offline replay: this answer came from a recorded response, so no model was called and nothing was billed. Token counts are the recorded ones."}
          </span>
        </p>
      ) : null}

      {run.error && !isSkippedReplay(run.status, run.input) ? (
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
          <span aria-hidden className="es-pulse glow-human size-2 rounded-full bg-pink-500" />
          Paused at an approval gate.
          <Link href={gateLink.href} className="inline-flex items-center gap-1 text-pink-300 underline underline-offset-2 hover:text-pink-300/80">
            {gateLink.label} <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      ) : null}

      {video ? (
        <Section id="recording" title="Screen recording" meta="recorded by the fenced browser" className="mt-8">
          <video
            src={video}
            controls
            preload="metadata"
            playsInline
            muted
            data-testid="run-video"
            aria-label={`Screen recording of the ${agentLabel(run.agent).toLowerCase()} run`}
            className="aspect-video w-full max-w-[880px] glass rounded-[18px]"
          />
        </Section>
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
            {hiddenNoise ? (
              <span className="ml-2 text-fg-3" data-testid="trace-hidden-noise">
                · <span className="num">{hiddenNoise}</span> dev-server {hiddenNoise === 1 ? "event" : "events"} hidden
              </span>
            ) : null}
            {live ? <span className="ml-2 text-blue-300">streaming</span> : null}
          </>
        }
        className="mt-8"
      >
        <StepViewer runId={run.id} steps={steps} startedAt={run.startedAt.toISOString()} endAt={endAt} live={live} />
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
