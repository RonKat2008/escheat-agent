import Link from "next/link";
import { EmptyState, StatusPill } from "@/components/primitives";
import { formatCostMicros, formatDuration } from "@/components/b/trace";
import { listAgentRuns } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";

const PAGE = 40;
const STATUSES = ["running", "succeeded", "failed"] as const;

const AGENT_LABEL: Record<string, string> = {
  filing_agent: "Filing agent",
  recovery_agent: "Recovery agent",
  claim_agent: "Claim agent",
  classifier: "Classifier",
  rule_research: "Rule research",
  letter_writer: "Letter writer",
  payee_resolver: "Payee resolver",
  reply_parser: "Reply parser",
};
export const agentLabel = (a: string) => AGENT_LABEL[a] ?? a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-8 max-sm:h-10 items-center rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active ? "border-strong bg-raised text-foreground" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

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

  if (all.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface p-6">
        <EmptyState
          title="No agent runs yet"
          description="Runs appear here when an agent classifies items, researches a rule, drafts a letter, or drives a replica portal. Without an Anthropic key the browser agents run scripted and say so."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip href={href(undefined, status)} active={!agent}>All agents</Chip>
          {agents.map((a) => (
            <Chip key={a} href={href(a, status)} active={agent === a}>
              {agentLabel(a)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip href={href(agent, undefined)} active={!status}>Any status</Chip>
          {STATUSES.map((s) => (
            <Chip key={s} href={href(agent, s)} active={status === s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-border bg-surface">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <caption className="sr-only">Agent runs, newest first</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Agent</th>
              <th scope="col" className="px-3 py-2.5 font-medium max-md:hidden">Model</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Duration</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium max-md:hidden">Tokens</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium max-md:hidden">Cost</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No runs match these filters.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const dur = r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null;
              const tokens = (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
              return (
                <tr key={r.id} className="group relative h-11 border-b border-border last:border-0 hover:bg-raised">
                  <td className="px-4 font-medium">
                    <Link href={`/runs/${r.id}`} className="outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset">
                      {agentLabel(r.agent)}
                    </Link>
                  </td>
                  <td className="px-3 font-mono text-xs text-muted-foreground max-md:hidden">{r.model ?? "Unknown"}</td>
                  <td className="px-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 text-right font-mono tabular-nums">{dur != null ? formatDuration(dur) : <span className="text-muted-foreground">...</span>}</td>
                  <td className="px-3 text-right font-mono tabular-nums max-md:hidden">{tokens ? tokens.toLocaleString("en-US") : <span className="text-muted-foreground">none</span>}</td>
                  <td className="px-3 text-right font-mono tabular-nums max-md:hidden">{r.costUsdMicros != null ? formatCostMicros(r.costUsdMicros) : <span className="text-muted-foreground">none</span>}</td>
                  <td className="px-4 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">{r.startedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {matching.length > rows.length ? (
        <p className="text-sm text-muted-foreground">
          Showing the latest {rows.length} of {matching.length}.{" "}
          <Link href={`${href(agent, status)}${agent || status ? "&" : "?"}all=1`} className="underline underline-offset-2 hover:text-foreground">
            Show all
          </Link>
        </p>
      ) : null}
    </div>
  );
}
