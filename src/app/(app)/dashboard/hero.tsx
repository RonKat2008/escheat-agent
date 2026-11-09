import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleCheck } from "lucide-react";
import { AnimatedNumber, InstrumentLabel, SyntheticChip, UnverifiedBanner } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { MoneyMap, placeableStates } from "@/components/viz/money-map/MoneyMap";
import { StageTrack, type StageState } from "@/components/viz/core";
import { NOT_COVERED_COPY, notCoveredStatesLabel } from "@/lib/coverage";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { roundedWholeUSD } from "@/components/viz/core/money-label";
import { cn } from "@/lib/utils";
import { heroBuckets, type HeroBucket } from "./buckets";
import { heroDeadlineCards } from "./hero-deadlines";
import { FeatureStrip, HeroDeadlinePanel } from "./hero-stage";
import { upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { loadDashboard, type DashboardData } from "./data";
import { DashboardOverdue } from "./overdue";
import { CfoBriefButton } from "./cfo-brief-button";
import { catchUpHref } from "@/lib/reports/late-money";
import { LoopBar } from "@/components/shell/LoopBar";

/** What the headline is made of, by what the reader has to do. Links filter Items to that status. */
function BucketRow({ buckets }: { buckets: HeroBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <ul aria-label="What the total is made of" className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
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
    <aside aria-labelledby="needs-you-h" data-testid="needs-you" className="glass relative mt-8 min-w-0 overflow-hidden rounded-[22px]">
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
      <div className="es-scroll-x border-t border-line bg-ink-0/30 px-3 py-2">
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

/** The panel's closing tag: overdue first, then approvals; steel (system) when nothing waits on a person. */
function heroTag(d: DashboardData): { text: string; human: boolean; href: string } {
  if (d.overdue.count > 0) return { text: `${d.overdue.count} overdue`, human: true, href: "/items?overdue=1" };
  const approve = d.loop.counts.approve ?? 0;
  if (approve > 0) return { text: `${approve} ${approve === 1 ? "needs" : "need"} your approval`, human: true, href: "/approvals" };
  return { text: "Nothing waiting on you", human: false, href: "/forecast" };
}

/**
 * The coral CTA follows the first thing waiting on a person: the catch-up filing when a state's report is late (the
 * overdue band below repeats it), else the first waiting action, in words that differ from Needs you's own button.
 */
function heroCta(d: DashboardData): { href: string; label: string } {
  if (d.lateMoney.catchUp) return { href: catchUpHref(d.lateMoney.catchUp.state), label: "Generate & file catch-up report" };
  const lead = waitingActions(d)[0];
  if (!lead) return { href: "/forecast", label: "See upcoming deadlines" };
  return { href: lead.href, label: lead.label.replace(/^Review /, "Open ") };
}

const MAX_WHERE_STATES = 4;

/**
 * V4 dashboard stage (docs/DESIGN-V4.md §7), composed like the Tidewell reference: the exposure as a huge light
 * headline low on the left, a stacked glass panel of the next two deadlines top right, the coral CTA and a ghost link
 * level with the copy, and a five-column feature strip on a hairline. The denser widgets (buckets, Needs you, Money
 * Map) follow below the stage, still inside the same "Total exposure" region.
 */
export async function HeroExposure() {
  const d = await loadDashboard();
  const { db, companyId } = await getCtx();
  const dl = await upcomingDeadlines(db, companyId, 400);
  const { exposure: exp, first } = d;
  const states = exp.byState;
  const cov = exp.coverage;
  const nc = cov.notCovered;
  const cards = heroDeadlineCards({
    asOf: exp.asOf,
    overdue: d.overdue.items.map((o) => ({
      itemId: o.itemId,
      payeeName: o.payeeName,
      state: o.state,
      cents: o.amount.cents,
      kind: o.earliest.kind,
      date: o.earliest.date,
      daysLate: o.earliest.daysLate,
      verified: o.verified,
    })),
    upcoming: dl.events.map((e) => ({
      itemId: e.itemId,
      payeeName: e.payeeName,
      state: e.state,
      cents: e.amount.cents,
      kind: e.kind,
      date: e.date,
      daysUntil: e.daysUntil,
      verified: e.verified,
    })),
  });
  const stateCodes = states.map((s) => s.state);
  const extra = stateCodes.length > MAX_WHERE_STATES ? ` +${stateCodes.length - MAX_WHERE_STATES}` : "";
  const where = `${formatDate(exp.asOf)} · ${stateCodes.slice(0, MAX_WHERE_STATES).join(", ")}${extra}`;
  const cta = heroCta(d);
  return (
    <>
      <section aria-label="Total exposure" data-tour="exposure" data-first-visit={first ? "true" : "false"}>
        <div
          data-testid="dash-stage"
          className="es-stage flex flex-col sm:px-2 lg:min-h-[max(600px,calc(100dvh-76px))] lg:px-4"
        >
          <div className="grid flex-1 gap-x-10 gap-y-7 lg:grid-cols-12 lg:grid-rows-[1fr_auto]">
            {/* headline: low on the left, two lines, huge and light */}
            <div className="min-w-0 self-end lg:col-span-8 lg:col-start-1 lg:row-start-1" data-tour="exposure-total">
              <p className="text-[13px] text-fg-2">Outstanding, not yet filed</p>
              <h2 className="type-display mt-3 text-[clamp(2.6rem,0.2rem+4.3vw,4.9rem)] leading-[0.98] tracking-[-0.05em]">
                <span className={cn("money-flow money-flow-hero block", first && "es-text-bloom")}>
                  <AnimatedNumber value={exp.totalCents} currency countUp="dashboard-exposure" />
                </span>
                <span className="block">owed to its owners.</span>
              </h2>
            </div>
            {/* the stacked glass panel, top right */}
            <div className="min-w-0 self-start lg:col-span-4 lg:col-start-9 lg:row-start-1">
              <HeroDeadlinePanel where={where} cards={cards} tag={heroTag(d)} />
            </div>
            {/* the muted copy under the headline */}
            <div className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-2">
              {/* R5-08: the count and the dollars above measure the same set (open, not yet reported:
                  getOpenCounts().unreported, which equals getExposure). Reported-but-unremitted items are a separate line. */}
              <p data-testid="exposure-meta" className="max-w-xl text-[15px] leading-6 text-fg-2">
                <span data-testid="exposure-count" className="num text-fg-1">
                  {d.openCounts.unreported.count}
                </span>{" "}
                stale items not yet reported
                {nc.count > 0 ? (
                  <>
                    , <span className="num text-fg-1">{cov.inScope.count}</span> of them across{" "}
                    <span className="num text-fg-1">{cov.inScope.states.length}</span> {cov.inScope.states.length === 1 ? "state" : "states"} we file in (
                    {cov.inScope.states.join(", ")})
                  </>
                ) : (
                  <>
                    , across <span className="num text-fg-1">{states.length}</span> {states.length === 1 ? "state" : "states"}
                  </>
                )}
                , as of{" "}
                <time dateTime={exp.asOf} className="text-fg-1">
                  {formatDate(exp.asOf)}
                </time>
                . The agent drafts every letter and report; nothing leaves until you approve it.
              </p>
              {nc.count > 0 ? (
                <div
                  data-testid="not-covered-note"
                  className="mt-3 max-w-xl rounded-[14px] border border-dashed border-line-strong bg-ink-0/30 px-3 py-2 text-[13px] text-fg-2"
                >
                  <p className="text-fg-1">
                    <Link href="/items?coverage=none" className="underline decoration-line-strong underline-offset-2 hover:decoration-blue-400">
                      Not covered yet: <span className="font-mono">{notCoveredStatesLabel(nc)}</span> · <span className="num">{nc.count}</span>{" "}
                      {nc.count === 1 ? "item" : "items"} · <span className="num">{nc.formatted}</span>
                    </Link>
                  </p>
                  <p className="mt-1">{NOT_COVERED_COPY} Included in the total above.</p>
                </div>
              ) : null}
              {d.openCounts.reported.count > 0 ? (
                <p data-testid="exposure-reported-note" className="mt-1 text-sm text-fg-2">
                  + <span className="num text-fg-1">{d.openCounts.reported.count}</span> reported,{" "}
                  <Link href="/items?status=reported" className="num text-fg-1 underline decoration-line-strong underline-offset-2 hover:decoration-blue-400">
                    {formatUSD(d.openCounts.reported.cents)}
                  </Link>{" "}
                  to remit
                </p>
              ) : null}
            </div>
            {/* CTAs: bottom right, level with the copy */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 self-end lg:col-span-5 lg:col-start-8 lg:row-start-2 lg:justify-end">
              <Link href={cta.href} data-testid="hero-cta" className={cn(buttonVariants({ size: "lg" }), "group/cta h-11 px-5 text-[14px]")}>
                {cta.label}
                <ArrowUpRight
                  className="size-4 transition-transform duration-150 group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
              <Link
                href="/items"
                data-testid="hero-ghost"
                className="group/ghost inline-flex items-center gap-1 rounded-sm text-[14px] font-medium text-fg-1 underline-offset-4 hover:underline"
              >
                See every item
                <ArrowUpRight
                  className="size-4 transition-transform duration-150 group-hover/ghost:translate-x-0.5 group-hover/ghost:-translate-y-0.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </div>
          </div>
          <FeatureStrip openCount={d.openCounts.unreported.count} />
        </div>
        {/* Below the stage: the CFO brief, the full overdue band (its catch-up filing button and late money), then
            what the total is made of, what needs a person, and the Money Map. Same Suspense boundary, so nothing pops in. */}
        {/* The Core loop strip lands here on the dashboard (it sits under the top bar on every other page). */}
        <div data-testid="loop-slot" className="mt-12">
          <LoopBar placement="page" />
        </div>
        <div data-testid="cfo-brief-row" className="mt-8 mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-fg-2">What {d.company.name} owes the states in unclaimed property, where the money is, and what is due next.</p>
          <CfoBriefButton />
        </div>
        <DashboardOverdue summary={d.overdue} lateMoney={d.lateMoney} />
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <BucketRow buckets={heroBuckets(exp.byStatus)} />
            <NeedsYou d={d} />
          </div>
          <div className="min-w-0 lg:col-span-7" data-tour="states">
            <div className="flex items-center justify-between gap-3">
              <InstrumentLabel as="h2">Money map · exposure by owner state</InstrumentLabel>
              <SyntheticChip />
            </div>
            <MoneyMap
              states={d.mapStates}
              hqState={d.company.incorporationState}
              recovered={d.flow.recoveredByState.map((r) => ({ ...r, formatted: formatUSD(r.cents) }))}
              legend={<MapLegend d={d} />}
            />
          </div>
        </div>
      </section>
      {exp.anyUnverified ? <UnverifiedBanner className="mt-8" /> : null}
    </>
  );
}
