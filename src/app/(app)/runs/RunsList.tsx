import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { formatCostMicros, formatDuration } from "@/components/b/trace";
import { listAgentRuns } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import { RunStatus } from "./RunStatus";
import { absoluteTime, agentLabel, isScripted, relativeTime, runTask, stepCount } from "./run-meta";

export { agentLabel } from "./run-meta";

const PAGE = 40;
const STATUSES = ["running", "succeeded", "failed"] as const;
const CHIP = "inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 max-sm:h-9";

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(CHIP, active ? "border-line-strong bg-ink-3 text-fg-1" : "border-line text-fg-2 hover:border-line-hover hover:bg-ink-2 hover:text-fg-1")}
    >
      {children}
    </Link>
  );
}

const Dash = ({ title }: { title?: string }) => (
  <span className="text-fg-3" title={title}>
    —<span className="sr-only">{title ?? "Not recorded"}</span>
  </span>
);

/** Ghosted rows that show the shape of what will appear (30% opacity, no motion). */
function GhostRows() {
  return (
    <div aria-hidden className="pointer-events-none opacity-30 select-none">
      <div className="flex h-9 items-center gap-6 border-b border-line px-3 text-xs text-fg-3">
        <span className="w-16">Started</span>
        <span className="w-40">Agent</span>
        <span className="hidden flex-1 md:block">Task</span>
        <span className="ml-auto w-14 text-right">Steps</span>
        <span className="w-16 text-right">Duration</span>
        <span className="hidden w-24 sm:block">Status</span>
      </div>
      {[0.9, 0.7, 0.8, 0.6, 0.75].map((w, i) => (
        <div key={i} className="flex h-10 items-center gap-6 border-b border-line px-3">
          <span className="h-2.5 w-16 rounded-sm bg-ink-3" />
          <span className="h-2.5 w-40 rounded-sm bg-ink-3" style={{ width: `${w * 10}rem` }} />
          <span className="hidden h-2.5 flex-1 rounded-sm bg-ink-3 md:block" style={{ maxWidth: `${w * 20}rem` }} />
          <span className="ml-auto h-2.5 w-8 rounded-sm bg-ink-3" />
          <span className="h-2.5 w-12 rounded-sm bg-ink-3" />
          <span className="hidden w-24 items-center gap-2 sm:flex">
            <span className="size-3.5 rounded-full bg-blue-500/60" />
            <span className="h-2.5 w-14 rounded-sm bg-ink-3" />
          </span>
        </div>
      ))}
    </div>
  );
}

function NoRunsYet() {
  return (
    <div className="relative">
      <GhostRows />
      <div className="absolute inset-x-0 top-12 flex justify-start px-3 sm:top-16">
        <div className="max-w-md rounded-[10px] border border-line bg-ink-1/95 px-5 py-1 backdrop-blur-sm">
          <EmptyState
            title="No agent runs yet"
            description="Runs appear here when an agent classifies items, researches a rule, drafts a letter, or drives a replica portal. Without an Anthropic key the browser agents run scripted and say so."
            action={
              <Link href="/recoveries" className={cn(buttonVariants(), "gap-1.5")}>
                Run a recovery search <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
              </Link>
            }
          />
        </div>
      </div>
    </div>
  );
}

const TH = "h-9 px-3 text-left text-xs font-normal whitespace-nowrap text-fg-3";

export async function RunsList({ searchParams }: { searchParams: Promise<{ agent?: string; status?: string; all?: string }> }) {
  const { agent, status, all: showAll } = await searchParams;
  const { db, companyId } = await getCtx();
  const all = await listAgentRuns(db, companyId, { limit: 200 });
  const agents = [...new Set(all.map((r) => r.agent))].sort();
  const matching = all.filter((r) => (!agent || r.agent === agent) && (!status || r.status === status));
  const rows = showAll ? matching : matching.slice(0, PAGE);
  const href = (a?: string, s?: string) => {
    const q = new URLSearchParams();
    if (a) q.set("agent", a);
    if (s) q.set("status", s);
    const qs = q.toString();
    return qs ? `/runs?${qs}` : "/runs";
  };

  if (all.length === 0) return <NoRunsYet />;

  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => (!agent || r.agent === agent) && r.status === s).length]));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip href={href(undefined, status)} active={!agent}>
            All agents
          </Chip>
          {agents.map((a) => (
            <Chip key={a} href={href(a, status)} active={agent === a}>
              {agentLabel(a)}
            </Chip>
          ))}
        </div>
        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip href={href(agent, undefined)} active={!status}>
            Any status
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} href={href(agent, s)} active={status === s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="num ml-1.5 text-fg-3">{counts[s]}</span>
            </Chip>
          ))}
        </div>
      </div>

      <div className="-mx-4 sm:mx-0">
        <table className="w-full table-fixed text-[13px]">
          <caption className="sr-only">Agent runs, newest first</caption>
          <thead>
            <tr className="shadow-[inset_0_-1px_0_var(--color-line)]">
              <th scope="col" className={cn(TH, "w-[88px] pl-4 sm:w-[104px] sm:pl-3")}>
                Started
              </th>
              <th scope="col" className={cn(TH, "lg:w-[240px]")}>
                Agent
              </th>
              <th scope="col" className={cn(TH, "hidden lg:table-cell")}>
                Task
              </th>
              <th scope="col" className={cn(TH, "hidden w-[72px] text-right sm:table-cell")}>
                Steps
              </th>
              <th scope="col" className={cn(TH, "w-[76px] text-right sm:w-[88px]")}>
                Duration
              </th>
              <th scope="col" className={cn(TH, "hidden w-[96px] text-right md:table-cell")}>
                Cost
              </th>
              <th scope="col" className={cn(TH, "w-[40px] pr-4 sm:w-[128px] sm:pr-3")}>
                <span className="max-sm:sr-only">Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 sm:px-3">
                  <p className="text-sm text-fg-1">No runs match these filters.</p>
                  <Link href="/runs" className="mt-1 inline-block text-[13px] text-fg-2 underline underline-offset-2 hover:text-fg-1">
                    Clear filters
                  </Link>
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const dur = r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null;
              const tokens = (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
              const scripted = isScripted(r.input, r.model);
              const task = runTask(r.agent, r.input);
              return (
                <tr key={r.id} className="group relative border-b border-line transition-colors duration-100 hover:bg-ink-2 sm:h-11">
                  <td className="py-2.5 pr-3 pl-4 align-middle whitespace-nowrap text-fg-2 sm:pl-3">
                    <time dateTime={r.startedAt.toISOString()} title={absoluteTime(r.startedAt)} className="num">
                      {relativeTime(r.startedAt)}
                    </time>
                  </td>
                  <td className="truncate px-3 py-2.5 align-middle">
                    <Link
                      href={`/runs/${r.id}`}
                      className="font-medium text-fg-1 outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-blue-400"
                    >
                      {agentLabel(r.agent)}
                    </Link>
                    {scripted ? <span className="ml-2 text-xs text-fg-3">Scripted</span> : null}
                    {task ? <span className="mt-0.5 block truncate text-xs text-fg-3 lg:hidden">{task}</span> : null}
                  </td>
                  <td className="hidden truncate px-3 align-middle text-fg-2 lg:table-cell">{task ?? <Dash />}</td>
                  <td className="num hidden px-3 text-right align-middle text-fg-2 sm:table-cell">{stepCount(r.trace)}</td>
                  <td className="num px-3 text-right align-middle text-fg-1">{dur != null ? formatDuration(dur) : <span className="text-fg-3">Live</span>}</td>
                  <td className="num hidden px-3 text-right align-middle text-fg-2 md:table-cell">
                    {r.costUsdMicros != null ? (
                      <span title={tokens ? `${tokens.toLocaleString("en-US")} tokens` : undefined}>{formatCostMicros(r.costUsdMicros)}</span>
                    ) : (
                      <Dash title={scripted ? "Scripted mode: no model calls, no cost" : "Cost not recorded"} />
                    )}
                  </td>
                  <td className="py-2.5 pr-4 pl-3 align-middle sm:pr-3">
                    <RunStatus status={r.status} labelClassName="max-sm:sr-only" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {matching.length > rows.length ? (
        <p className="mt-4 text-[13px] text-fg-3">
          Showing the latest <span className="num text-fg-1">{rows.length}</span> of <span className="num text-fg-1">{matching.length}</span>.{" "}
          <Link href={`${href(agent, status)}${agent || status ? "&" : "?"}all=1`} className="text-fg-2 underline underline-offset-2 hover:text-fg-1">
            Show all
          </Link>
        </p>
      ) : null}
    </div>
  );
}
