import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AnimatedNumber } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { NOT_COVERED_COPY, notCoveredStatesLabel } from "@/lib/coverage";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { heroDeadlineCards, heroDeadlineWhere } from "./hero-deadlines";
import { FeatureStrip, HeroDeadlinePanel } from "./hero-stage";
import { upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { loadDashboard, type DashboardData } from "./data";
import { catchUpHref } from "@/lib/reports/late-money";
import { waitingActions } from "./needs-you";

/** The panel's closing tag: overdue first, then approvals; steel (system) when nothing waits on a person. */
function heroTag(d: DashboardData): { text: string; human: boolean; href: string } {
  if (d.overdue.count > 0) return { text: `${d.overdue.count} overdue`, human: true, href: "/items?overdue=1" };
  const approve = d.loop.counts.approve ?? 0;
  if (approve > 0) return { text: `${approve} ${approve === 1 ? "needs" : "need"} your approval`, human: true, href: "/approvals" };
  return { text: "Nothing waiting on you", human: false, href: "/forecast" };
}

/**
 * The CTA follows the first thing waiting on a person: the catch-up filing when a state's report is late (the overdue
 * band below repeats it), else the first waiting action, in words that differ from Needs you's own button. Those are
 * coral (a person must act). With nothing waiting it is a quiet outline link: the deadlines question in Ask when Ask can
 * answer it today, else the Forecast page.
 */
function heroCta(d: DashboardData, askDeadlines: string | null): { href: string; label: string; human: boolean } {
  if (d.lateMoney.catchUp) return { href: catchUpHref(d.lateMoney.catchUp.state), label: "Generate & file catch-up report", human: true };
  const lead = waitingActions(d)[0];
  if (lead) return { href: lead.href, label: lead.label.replace(/^Review /, "Open "), human: true };
  return askDeadlines ? { href: askDeadlines, label: "Ask what is due next", human: false } : { href: "/forecast", label: "See upcoming deadlines", human: false };
}


/**
 * V4 dashboard stage (docs/DESIGN-V4.md §7), composed like the Tidewell reference: the exposure as a huge light
 * headline low on the left, a stacked glass panel of the next two deadlines top right, the coral CTA and a ghost link
 * level with the copy, and a five-column feature strip on a hairline. Everything below the stage is in ./below.tsx.
 */
export async function HeroExposure({ askDeadlines = null }: { askDeadlines?: string | null }) {
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
  const where = heroDeadlineWhere(exp.asOf, cards);
  const cta = heroCta(d, askDeadlines);
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
              <h2 className="type-display mt-3 text-[clamp(2.75rem,0.3rem+5.3vw,6rem)] leading-[0.96] tracking-[-0.05em]">
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
              {/* exposure-meta is the counts sentence only (the tour quotes it); the reassurance follows it. */}
              <p className="max-w-xl text-[15px] leading-6 text-fg-2">
                <span data-testid="exposure-meta">
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
                .
                </span>{" "}
                The agent drafts every letter and report; nothing leaves until you approve it.
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
              <Link href={cta.href} data-testid="hero-cta"
                data-human={cta.human ? "true" : "false"}
                className={cn(buttonVariants({ size: "lg", variant: cta.human ? "default" : "outline" }), "group/cta h-11 px-5 text-[14px]")}>
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
      </section>
    </>
  );
}
