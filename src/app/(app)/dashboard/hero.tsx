import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { ArrowRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { AnimatedNumber, UnverifiedBanner } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { outreach, reports } from "@/db/schema";
import { DEADLINE_LABEL, formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { getExposure, getOverdue, listStaleItems, upcomingDeadlines } from "@/lib/queries";
import { OverduePanel } from "@/components/overdue/OverduePanel";
import { isFirstVisit } from "@/components/motion/first-visit";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";
import { heroBuckets, type HeroBucket } from "./buckets";
import { DueChip } from "./DueChip";

/** Lightness, not hue, separates states: blue-500, blue-300, white 55%. Always labelled directly. */
const STATE_FILL = ["bg-blue-500", "bg-blue-300", "bg-white/55", "bg-white/30", "bg-white/15"];

interface StateSlice {
  state: string;
  cents: number;
  count: number;
  formatted: string;
}

/**
 * One continuous bar split by state. On the first visit of the session it sweeps in left to right (a clip-path wipe,
 * so the segment widths are final from the first paint and nothing shifts); the labels rise in behind it.
 */
function StateBar({ states, total }: { states: StateSlice[]; total: number }) {
  return (
    <div className="mt-9">
      <div
        role="img"
        aria-label={`Exposure by state: ${states.map((s) => `${s.state} ${s.formatted}`).join(", ")}`}
        data-testid="state-bar"
        className="es-wipe flex h-2 gap-[3px]"
      >
        {states.map((s, i) => (
          <div
            key={s.state}
            className={cn("h-full first:rounded-l-[3px] last:rounded-r-[3px]", STATE_FILL[Math.min(i, STATE_FILL.length - 1)])}
            style={{ width: `${Math.max(2, (s.cents / Math.max(1, total)) * 100)}%` }}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-x-4 sm:flex sm:gap-x-10">
        {states.map((s, i) => (
          <li key={s.state} className="es-stagger min-w-0" style={{ ["--i" as string]: i + 3 }}>
            <Link
              href={`/items?state=${s.state}`}
              data-testid={`state-tile-${s.state}`}
              className="group -mx-1.5 block rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-ink-2"
            >
              <span className="flex items-center gap-1.5 text-[13px] text-fg-2">
                <span aria-hidden className={cn("size-2 rounded-[2px]", STATE_FILL[Math.min(i, STATE_FILL.length - 1)])} />
                {s.state}
                <span className="num text-fg-3">
                  {s.count}
                  <span className="hidden sm:inline"> items</span>
                </span>
              </span>
              <span className="num mt-0.5 block text-base font-medium tracking-[-0.01em] text-fg-1 sm:text-lg">{s.formatted.replace(/\.\d{2}$/, "")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the headline is made of, by what the reader has to do. Links filter Items to that status. */
function BucketRow({ buckets }: { buckets: HeroBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <ul aria-label="What the total is made of" className="mt-7 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
      {buckets.map((b, i) => (
        <li key={b.id} className="es-stagger min-w-0" style={{ ["--i" as string]: i }} data-testid={`bucket-${b.id}`}>
          <Link href={`/items?status=${b.status}`} title={b.hint} className="group -mx-1.5 block rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-ink-2">
            <span className="block text-[13px] text-fg-2">
              {b.label} <span className="num text-fg-3">{b.count}</span>
            </span>
            <span className="num mt-0.5 block text-base font-medium tracking-[-0.01em] text-fg-1">{formatUSD(b.cents).replace(/\.\d{2}$/, "")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

interface NextDeadline {
  itemId: string;
  date: string;
  kind: string;
  daysUntil: number;
  payeeName: string;
  state: string | null;
}

function NextDeadlineRow({ next }: { next: NextDeadline }) {
  return (
    <div className="border-t border-line bg-ink-1/60 px-5 pt-3.5 pb-3">
      <h3 className="text-xs text-fg-3">Next deadline</h3>
      <Link href={`/items?item=${next.itemId}`} className="group -mx-2 mt-1 block rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-3">
        <span className="flex items-center justify-between gap-3">
          <span className="num text-sm text-fg-1">{formatDate(next.date)}</span>
          <DueChip days={next.daysUntil} kind={next.kind} />
        </span>
        <span className="mt-1 block truncate text-[13px] text-fg-2">
          {DEADLINE_LABEL[next.kind]} for {next.payeeName}, {next.state ?? "state unknown"}
        </span>
      </Link>
    </div>
  );
}

interface NextAction {
  href: string;
  /** Primary-button label when this row is first. */
  label: string;
  /** One line under the lead action saying what happens when you open it. */
  detail: string;
  n: number;
  one: string;
  many: string;
}

/**
 * What is waiting on a human, as a panel: the one place on the page that asks for something. The first action leads
 * (big pink count, what it is, what opening it does, the only primary button); the rest are compact rows.
 */
function NeedsYou({ actions, next }: { actions: NextAction[]; next: NextDeadline | null }) {
  const [lead, ...rest] = actions;
  const waiting = actions.reduce((a, x) => a + x.n, 0);
  return (
    <aside
      aria-labelledby="needs-you-h"
      data-testid="needs-you"
      className="relative min-w-0 self-start overflow-hidden rounded-xl border border-line bg-ink-2 lg:mt-1"
    >
      {lead ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-pink-500/80 via-pink-500/25 to-transparent" /> : null}
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
        <h2 id="needs-you-h" className="text-[13px] font-medium text-fg-1">
          Needs you
        </h2>
        {lead ? (
          <span className="text-xs text-fg-3">
            <span className="num text-fg-2">{waiting}</span> waiting
          </span>
        ) : null}
      </div>
      {lead ? (
        <div className="px-5 pt-3 pb-5">
          <p className="flex items-baseline gap-3">
            <span className="num text-[40px] leading-none font-medium tracking-[-0.03em] text-pink-400">{lead.n}</span>
            <span className="min-w-0 text-sm text-fg-1">{lead.n === 1 ? lead.one : lead.many}</span>
          </p>
          <p className="mt-2 text-[13px] text-fg-2">{lead.detail}</p>
          <Link href={lead.href} className={cn(buttonVariants(), "group/cta mt-4 w-full justify-between")}>
            {lead.label}
            <ArrowRight className="size-4 transition-transform duration-150 group-hover/cta:translate-x-0.5" strokeWidth={1.75} aria-hidden />
          </Link>
          {rest.length > 0 ? (
            <ul className="-mx-2 mt-4 border-t border-line pt-2" aria-label="Also waiting">
              {rest.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} className="group flex items-baseline gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-3">
                    <span className="num w-6 shrink-0 text-[15px] font-medium text-pink-400">{a.n}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-fg-1">{a.n === 1 ? a.one : a.many}</span>
                    <ArrowUpRight
                      className="size-3.5 shrink-0 self-center text-fg-3 transition-[color,transform] duration-150 group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-fg-1"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="px-5 pt-3 pb-5">
          <p className="flex items-center gap-2 text-sm text-fg-1">
            <CheckCircle2 className="size-4 shrink-0 text-blue-500" strokeWidth={1.75} aria-hidden />
            Nothing is waiting on you
          </p>
          <p className="mt-1.5 text-[13px] text-fg-2">The agent is watching every item and will queue letters and reports here when they are due.</p>
          <Link href="/items?sort=deadline_asc" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
            See upcoming deadlines
          </Link>
        </div>
      )}
      {next ? <NextDeadlineRow next={next} /> : null}
    </aside>
  );
}

export async function HeroExposure() {
  const { db, companyId } = await getCtx();
  const [first, exp, dl, review, drafts, ready, overdue] = await Promise.all([
    isFirstVisit("dashboard"),
    getExposure(db, companyId),
    upcomingDeadlines(db, companyId, 400),
    listStaleItems(db, companyId, { needsReview: true, limit: 1 }),
    db
      .select({ n: count() })
      .from(outreach)
      .where(and(eq(outreach.companyId, companyId), inArray(outreach.status, ["draft", "awaiting_approval"]))),
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.companyId, companyId), inArray(reports.status, ["validated", "awaiting_approval", "approved"]))),
    getOverdue(db, companyId),
  ]);
  const states = [...exp.byState].sort((a, b) => b.cents - a.cents);
  const buckets = heroBuckets(exp.byStatus);
  const actions: NextAction[] = [
    {
      href: "/items?overdue=1",
      label: "Review overdue items",
      detail: `${formatUSD(overdue.total.cents)} is past a report, remittance or due-diligence deadline. File or resolve these first.`,
      n: overdue.count,
      one: "item overdue",
      many: "items overdue",
    },
    {
      href: "/approvals",
      label: "Review approvals",
      detail: "Read each letter exactly as it will be sent. Nothing goes out until you approve it.",
      n: drafts[0]?.n ?? 0,
      one: "draft awaiting approval",
      many: "drafts awaiting approval",
    },
    {
      href: "/items?review=1",
      label: "Review items",
      detail: "Low-confidence classifications or items no rule covers yet. Confirm them so their dates hold.",
      n: review.total,
      one: "item needs review",
      many: "items need review",
    },
    {
      href: "/reports",
      label: "Review reports",
      detail: "Validated holder reports waiting for your sign-off before filing.",
      n: ready[0]?.n ?? 0,
      one: "report ready to file",
      many: "reports ready to file",
    },
  ].filter((a) => a.n > 0);
  return (
    <>
      {/* Overdue first: the most urgent fact, ahead of the total and upcoming deadlines (same Suspense, so no layout shift). */}
      <OverduePanel summary={overdue} className="mb-10" />
      <section
        aria-label="Total exposure"
        data-first-visit={first ? "true" : "false"}
        className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12"
      >
        <div className="min-w-0">
          <p className="text-[13px] text-fg-2">Outstanding, not yet filed</p>
          <div className="money-flow money-flow-hero mt-2 text-[clamp(3rem,1.6rem+5vw,5.5rem)] leading-[0.95] font-medium tracking-[-0.045em] text-fg-1">
            <AnimatedNumber value={exp.totalCents} currency countUp="dashboard-exposure" />
          </div>
          <p data-testid="exposure-meta" className="mt-4 text-sm text-fg-2">
            <span className="num text-fg-1">{exp.itemCount}</span> stale items across{" "}
            <span className="num text-fg-1">{states.length}</span> {states.length === 1 ? "state" : "states"}, as of{" "}
            <time dateTime={exp.asOf} className="text-fg-1">
              {formatDate(exp.asOf)}
            </time>
          </p>
          <BucketRow buckets={buckets} />
          <StateBar states={states} total={exp.totalCents} />
        </div>
        <NeedsYou actions={actions} next={dl.events.find((e) => e.daysUntil >= 0) ?? null} />
      </section>
      {exp.anyUnverified ? <UnverifiedBanner className="mt-10" /> : null}
    </>
  );
}

