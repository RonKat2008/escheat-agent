import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleCheck } from "lucide-react";
import { AnimatedNumber, InstrumentLabel, SyntheticChip, UnverifiedBanner } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { MoneyMap, placeableStates } from "@/components/viz/money-map/MoneyMap";
import { StageTrack, type StageState } from "@/components/viz/core";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { roundedWholeUSD } from "@/components/viz/core/money-label";
import { cn } from "@/lib/utils";
import { heroBuckets, type HeroBucket } from "./buckets";
import { loadDashboard, type DashboardData } from "./data";
import { DashboardOverdue } from "./overdue";

/** What the headline is made of, by what the reader has to do. Links filter Items to that status. */
function BucketRow({ buckets }: { buckets: HeroBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <ul aria-label="What the total is made of" className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
      {buckets.map((b) => (
        <li key={b.id} className="min-w-0" data-testid={`bucket-${b.id}`}>
          <Link href={`/items?status=${b.status}`} title={b.hint} className="-mx-1.5 block rounded-[6px] px-1.5 py-1 transition-colors duration-150 hover:bg-ink-2">
            <span className="block text-xs text-pretty text-fg-2">
              {b.label} <span className="num text-fg-3">{b.count}</span>
            </span>
            <span className="num mt-0.5 block text-[15px] font-medium tracking-[-0.01em] text-fg-1">{roundedWholeUSD(b.cents)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

interface WaitingAction {
  href: string;
  label: string;
  detail: string;
  n: number;
  one: string;
  many: string;
}

function waitingActions(d: DashboardData): WaitingAction[] {
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
function NeedsYou({ d }: { d: DashboardData }) {
  const actions = waitingActions(d);
  const [lead, ...rest] = actions;
  const waiting = actions.reduce((a, x) => a + x.n, 0);
  return (
    <aside aria-labelledby="needs-you-h" data-testid="needs-you" className="relative mt-8 min-w-0 overflow-hidden rounded-[10px] border border-line bg-ink-2">
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
            <span className="num text-[34px] leading-none font-medium tracking-[-0.03em] text-pink-400">{lead.n}</span>
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
                  <Link href={a.href} className="group flex items-baseline gap-3 rounded-[6px] px-2 py-1.5 transition-colors duration-150 hover:bg-ink-3">
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
          <Link href="/forecast" className={cn(buttonVariants({ variant: "outline" }), "mt-3.5")}>
            See upcoming deadlines
          </Link>
        </div>
      )}
      <div className="es-scroll-x border-t border-line bg-ink-1/60 px-3 py-2">
        <PipelineMini d={d} />
      </div>
    </aside>
  );
}

/** Legend under the map: how to read it, plus anything the map cannot place (never put on a guessed location). */
function MapLegend({ d }: { d: DashboardData }) {
  const { unplaced } = placeableStates(d.mapStates);
  const total = Math.max(1, d.flow.exposure.cents);
  const hq = d.company.incorporationState;
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden data-testid="state-bar" className="flex h-1.5 gap-[2px] overflow-hidden rounded-full">
        {d.mapStates.map((s, i) => (
          <span key={s.state} className={cn("h-full", i === 0 ? "bg-blue-500" : i === 1 ? "bg-blue-300" : "bg-fg-3")} style={{ width: `${(s.cents / total) * 100}%` }} />
        ))}
      </div>
      <p className="text-xs text-fg-2">
        Column height is the amount at risk in each owner state. Threads run from HQ ({hq}, state of incorporation). A pink ring means something there is overdue or
        due within 7 days. Hover or focus a column for its largest items.
      </p>
      {unplaced.map((s) => (
        <p key={s.state} className="flex items-center gap-1.5 text-xs text-fg-2">
          <span aria-hidden className="size-2 rounded-full border border-dashed border-fg-3" />
          Owner state unknown: <span className="num text-fg-1">{s.formatted}</span> across <span className="num">{s.count}</span> items, not placed on the map.
        </p>
      ))}
      {d.flow.recovered ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-2">
          <span aria-hidden className="h-px w-4 border-t border-dashed border-blue-300" />
          Recovered to you from state portals: <span className="num text-blue-300">{formatUSD(d.flow.recovered.cents)}</span>
        </p>
      ) : null}
    </div>
  );
}

export async function HeroExposure() {
  const d = await loadDashboard();
  const { exposure: exp, first } = d;
  const states = exp.byState;
  return (
    <>
      {/* Overdue first: the most urgent fact, ahead of the total (same Suspense boundary, so it never pops in late). */}
      <DashboardOverdue summary={d.overdue} lateMoney={d.lateMoney} />
      <section aria-label="Total exposure" data-tour="exposure" data-first-visit={first ? "true" : "false"} className="grid gap-x-10 gap-y-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5" data-tour="exposure-total">
          <p className="text-[13px] text-fg-2">Outstanding, not yet filed</p>
          <div
            className={cn(
              "money-flow money-flow-hero mt-2 text-[clamp(2.75rem,1.6rem+3.6vw,4.5rem)] leading-none font-medium tracking-[-0.045em] text-fg-1",
              first && "es-text-bloom",
            )}
          >
            <AnimatedNumber value={exp.totalCents} currency countUp="dashboard-exposure" />
          </div>
          {/* R5-08: the count and the dollars above measure the same set (open, not yet reported: getOpenCounts().unreported,
              which equals getExposure). Reported-but-unremitted items are a separate line with their own dollars. */}
          <p data-testid="exposure-meta" className="mt-4 text-sm text-fg-2">
            <span data-testid="exposure-count" className="num text-fg-1">
              {d.openCounts.unreported.count}
            </span>{" "}
            stale items not yet reported, across <span className="num text-fg-1">{states.length}</span> {states.length === 1 ? "state" : "states"}, as of{" "}
            <time dateTime={exp.asOf} className="text-fg-1">
              {formatDate(exp.asOf)}
            </time>
          </p>
          {d.openCounts.reported.count > 0 ? (
            <p data-testid="exposure-reported-note" className="mt-1 text-sm text-fg-2">
              + <span className="num text-fg-1">{d.openCounts.reported.count}</span> reported,{" "}
              <Link href="/items?status=reported" className="num text-fg-1 underline decoration-line-strong underline-offset-2 hover:decoration-blue-400">
                {formatUSD(d.openCounts.reported.cents)}
              </Link>{" "}
              to remit
            </p>
          ) : null}
          <BucketRow buckets={heroBuckets(exp.byStatus)} />
          <NeedsYou d={d} />
        </div>
        <div className="min-w-0 lg:col-span-7" data-tour="states">
          <div className="flex items-center justify-between gap-3">
            <InstrumentLabel as="h2">Money map · exposure by owner state</InstrumentLabel>
            <SyntheticChip />
          </div>
          <MoneyMap states={d.mapStates} hqState={d.company.incorporationState} recovered={d.flow.recoveredByState.map((r) => ({ ...r, formatted: formatUSD(r.cents) }))} legend={<MapLegend d={d} />} />
        </div>
      </section>
      {exp.anyUnverified ? <UnverifiedBanner className="mt-8" /> : null}
    </>
  );
}
