import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StageTrack, type StageState } from "@/components/viz/core";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DashboardData } from "./data";

/** What is waiting on a person, in order of urgency (overdue first). The hero's coral CTA follows the first one. */
export interface WaitingAction {
  href: string;
  label: string;
  detail: string;
  n: number;
  one: string;
  many: string;
}

export function waitingActions(d: DashboardData): WaitingAction[] {
  return [
    {
      href: "/items?overdue=1",
      label: "Review overdue items",
      detail: `${formatUSD(d.overdue.total.cents)} is past a report, remittance or due-diligence deadline. File or resolve these first.`,
      n: d.overdue.count,
      one: "item overdue",
      many: "items overdue",
    },
    {
      // Owner loop: an owner answered a sent notice; the holder verifies, reissues and marks it resolved in Approvals.
      href: "/approvals?kind=owner",
      label: "Follow up on owner replies",
      detail: `Owners asked about ${formatUSD(d.counts.ownerTasksCents)}. Verify, reissue, then mark each one resolved.`,
      n: d.counts.ownerTasks,
      one: "owner reply to act on",
      many: "owner replies to act on",
    },
    {
      href: "/approvals",
      label: "Review approvals",
      detail: "Read each letter exactly as it will be sent. Nothing goes out until you approve it.",
      n: d.counts.drafts,
      one: "draft awaiting approval",
      many: "drafts awaiting approval",
    },
    {
      href: "/items?review=1",
      label: "Review items",
      detail: "Low-confidence classifications or items no rule covers yet. Confirm them so their dates hold.",
      n: d.counts.review,
      one: "item needs review",
      many: "items need review",
    },
    {
      href: "/reports",
      label: "Review reports",
      detail: "Validated holder reports waiting for your sign-off before filing.",
      n: d.counts.ready,
      one: "report ready to file",
      many: "reports ready to file",
    },
  ].filter((a) => a.n > 0);
}

/** The loop as a mini pipeline (same counts as the Loop Bar). Human-blocked stages read pink by shape and label. */
function PipelineMini({ d }: { d: DashboardData }) {
  const c = d.loop.counts;
  const st = (n: number | null, human: boolean): StageState => (n === null ? "unknown" : n === 0 ? "idle" : human ? "human" : "waiting");
  return (
    <StageTrack
      size="sm"
      aria-label="Core loop counts"
      stages={[
        { id: "triage", label: "Triage", count: c.triage, state: st(c.triage, true), href: "/items?view=needs-action" },
        { id: "draft", label: "Draft", count: c.draft, state: st(c.draft, false), href: "/items?view=draft-ready" },
        { id: "approve", label: "Approve", count: c.approve, state: st(c.approve, true), href: "/approvals" },
        { id: "file", label: "File", count: c.file, state: st(c.file, false), href: "/reports?filter=approved" },
      ]}
    />
  );
}

/**
 * What is waiting on a person: the one place on the page that asks for something. Overdue leads when anything is
 * overdue; the first action is its only primary button (the Overdue band above carries the catch-up filing button).
 */
export function NeedsYou({ d, askDeadlines = null }: { d: DashboardData; askDeadlines?: string | null }) {
  const actions = waitingActions(d);
  const [lead, ...rest] = actions;
  const waiting = actions.reduce((a, x) => a + x.n, 0);
  return (
    <aside aria-labelledby="needs-you-h" data-testid="needs-you" className="glass relative min-w-0 overflow-hidden rounded-[22px]">
      {lead ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-pink-500/80 via-pink-500/25 to-transparent" /> : null}
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
        <h2 id="needs-you-h" className="instrument-label">
          Needs you
        </h2>
        {lead ? (
          <span className="text-xs text-fg-2">
            <span className="num text-fg-1">{waiting}</span> waiting
          </span>
        ) : null}
      </div>
      {lead ? (
        <div className="px-4 pt-2.5 pb-4">
          <p className="flex items-baseline gap-3">
            <span className="num text-[40px] leading-none font-light tracking-[-0.04em] text-pink-400">{lead.n}</span>
            <span className="min-w-0 text-sm text-fg-1">{lead.n === 1 ? lead.one : lead.many}</span>
          </p>
          <p className="mt-1.5 text-[13px] text-fg-2">{lead.detail}</p>
          <Link href={lead.href} className={cn(buttonVariants(), "group/cta mt-3.5 w-full justify-between")}>
            {lead.label}
            <ArrowRight className="size-4 transition-transform duration-150 group-hover/cta:translate-x-0.5" strokeWidth={1.75} aria-hidden />
          </Link>
          {rest.length > 0 ? (
            <ul className="-mx-2 mt-3 border-t border-line pt-1.5" aria-label="Also waiting">
              {rest.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} className="group flex items-baseline gap-3 rounded-[6px] px-2 py-1.5 transition-colors duration-150 hover:bg-fg-1/[0.06]">
                    <span className="num w-6 shrink-0 text-[15px] font-medium text-pink-400">{a.n}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-fg-1">{a.n === 1 ? a.one : a.many}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 self-center text-fg-3 transition-colors duration-150 group-hover:text-fg-1" strokeWidth={1.5} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="px-4 pt-2.5 pb-4">
          <p className="flex items-center gap-2 text-sm text-fg-1">
            <CircleCheck className="size-4 shrink-0 text-blue-500" strokeWidth={1.5} aria-hidden />
            Nothing is waiting on you
          </p>
          <p className="mt-1.5 text-[13px] text-fg-2">The agent is watching every item and will queue letters and reports here when they are due.</p>
          <Link href={askDeadlines ?? "/forecast"} className={cn(buttonVariants({ variant: "outline" }), "mt-3.5")}>
            {askDeadlines ? "Ask what is due next" : "See upcoming deadlines"}
          </Link>
        </div>
      )}
      <div className="es-scroll-x border-t border-line bg-ink-0/30 px-3 py-2">
        <PipelineMini d={d} />
      </div>
    </aside>
  );
}

