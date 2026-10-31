import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { JsonView } from "@/components/b/JsonView";
import { collectCitations, formatCostMicros, formatDuration, normalizeTrace } from "@/components/b/trace";
import { PageHeader, StatusPill } from "@/components/primitives";
import type { AgentRun } from "@/db/schema";
import { agentLabel } from "../RunsList";
import { LiveRefresh } from "./LiveRefresh";
import { StepViewer } from "./StepViewer";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums break-words">{children}</dd>
    </div>
  );
}

export function RunDetail({ run }: { run: AgentRun }) {
  const steps = normalizeTrace(run.trace, run.finishedAt);
  const citations = collectCitations(run.trace, run.output);
  const dur = run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;
  const mode = (run.input as Record<string, unknown> | null)?.mode;
  const phase = (run.output as Record<string, unknown> | null)?.phase;
  const gate = phase === "awaiting_approval" || steps.some((s) => s.kind === "paused" || s.kind === "approval");
  return (
    <div>
      {run.status === "running" ? <LiveRefresh /> : null}
      <PageHeader
        title={agentLabel(run.agent)}
        description={
          mode === "scripted" ? "Scripted run: no model key is configured, so the portal steps were replayed deterministically and labeled as such." : undefined
        }
        actions={<StatusPill status={run.status} />}
      />
      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-[14px] border border-border bg-surface p-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Model">{run.model ?? "Unknown"}</Stat>
        <Stat label="Started">{run.startedAt.toISOString().slice(0, 16).replace("T", " ")}</Stat>
        <Stat label="Duration">{dur != null ? formatDuration(dur) : "Running"}</Stat>
        <Stat label="Tokens in / out">
          {run.inputTokens != null || run.outputTokens != null ? `${(run.inputTokens ?? 0).toLocaleString("en-US")} / ${(run.outputTokens ?? 0).toLocaleString("en-US")}` : "None"}
        </Stat>
        <Stat label="Cost">{formatCostMicros(run.costUsdMicros)}</Stat>
        <Stat label="Steps">{steps.length}</Stat>
      </dl>

      {run.error ? (
        <div role="alert" className="mb-5 rounded-xl border border-pink-500/60 bg-pink-900/40 p-4">
          <p className="text-sm font-medium">This run failed</p>
          <p className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">{run.error}</p>
        </div>
      ) : null}
      {gate && run.status === "running" ? (
        <div role="status" className="mb-5 flex items-center gap-3 rounded-xl border border-pink-500/60 bg-pink-900/40 p-4 text-sm">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-pink-500 motion-reduce:animate-none" />
          Paused at an approval gate.{" "}
          <Link href="/approvals" className="underline underline-offset-2">
            Review in Approvals
          </Link>
        </div>
      ) : null}

      <StepViewer steps={steps} />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <JsonView label="Input" value={run.input} defaultOpen={false} />
        <JsonView label="Output" value={run.output} defaultOpen={false} />
      </div>

      {citations.length > 0 ? (
        <section aria-labelledby="cit-h" className="mt-5 rounded-[14px] border border-border bg-surface p-5">
          <h2 id="cit-h" className="mb-3 text-[15px] font-semibold">
            Citations <span className="ml-1 font-mono text-sm text-muted-foreground">{citations.length}</span>
          </h2>
          <ul className="space-y-3">
            {citations.map((c) => (
              <li key={c.url} className="text-sm">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline">
                  {c.title} <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                {c.quote ? <p className="mt-1 max-w-[80ch] text-muted-foreground">&ldquo;{c.quote.slice(0, 320)}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
