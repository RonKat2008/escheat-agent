import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { ArrowUpRight } from "lucide-react";
import { AnimatedNumber, UnverifiedBanner } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { outreach, reports } from "@/db/schema";
import { DEADLINE_LABEL, formatDate, relativeDays } from "@/lib/format";
import { getExposure, listStaleItems, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";

/** Lightness, not hue, separates states: blue-500, blue-300, white 55%. Always labelled directly. */
const STATE_FILL = ["bg-blue-500", "bg-blue-300", "bg-white/55", "bg-white/30", "bg-white/15"];

interface StateSlice {
  state: string;
  cents: number;
  count: number;
  formatted: string;
}

function StateBar({ states, total }: { states: StateSlice[]; total: number }) {
  return (
    <div className="mt-9">
      <div
        role="img"
        aria-label={`Exposure by state: ${states.map((s) => `${s.state} ${s.formatted}`).join(", ")}`}
        className="flex h-2 gap-[3px]"
      >
        {states.map((s, i) => (
          <div
            key={s.state}
            className={cn("es-grow-x h-full first:rounded-l-[3px] last:rounded-r-[3px]", STATE_FILL[Math.min(i, STATE_FILL.length - 1)])}
            style={{ width: `${Math.max(2, (s.cents / Math.max(1, total)) * 100)}%`, ["--i" as string]: i }}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-x-4 sm:flex sm:gap-x-10">
        {states.map((s, i) => (
          <li key={s.state} className="min-w-0">
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

interface NextAction {
  href: string;
  n: number;
  one: string;
  many: string;
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
  const soon = next.daysUntil <= 7;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h2 className="text-[13px] text-fg-2">Next deadline</h2>
      <Link href={`/items?item=${next.itemId}`} className="group -mx-2 mt-2 block rounded-md px-2 py-2 transition-colors duration-150 hover:bg-ink-2">
        <span className="flex items-center justify-between gap-3">
          <span className="num text-sm text-fg-1">{formatDate(next.date)}</span>
          {soon ? (
            <span className="inline-flex h-5 items-center rounded-full bg-pink-500 px-2 text-xs font-medium whitespace-nowrap text-black">
              {next.daysUntil <= 0 ? "Due today" : `Due ${relativeDays(next.daysUntil)}`}
            </span>
          ) : (
            <span className="text-[13px] text-fg-3">{relativeDays(next.daysUntil)}</span>
          )}
        </span>
        <span className="mt-1 block truncate text-[13px] text-fg-2">
          {DEADLINE_LABEL[next.kind]} for {next.payeeName}, {next.state ?? "state unknown"}
        </span>
      </Link>
    </div>
  );
}

/** What is waiting on a human. The only pink numbers on the page. */
function NeedsYou({ actions, next }: { actions: NextAction[]; next: NextDeadline | null }) {
  return (
    <div className="min-w-0 lg:border-l lg:border-line lg:pl-8">
      <h2 className="text-[13px] text-fg-2">Needs you</h2>
      {actions.length === 0 ? (
        <p className="mt-3 text-sm text-fg-2">Nothing is waiting on you. The agent is watching every item.</p>
      ) : (
        <ul className="mt-2 -mx-2">
          {actions.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className="group flex items-baseline gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-ink-2"
              >
                <span className="num w-8 shrink-0 text-xl font-medium tracking-[-0.02em] text-pink-400">{a.n}</span>
                <span className="min-w-0 flex-1 text-sm text-fg-1">{a.n === 1 ? a.one : a.many}</span>
                <ArrowUpRight
                  className="size-4 shrink-0 self-center text-fg-3 transition-[color,transform] duration-150 group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-fg-1"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/items" className={cn(buttonVariants(), "mt-5 w-full sm:w-auto")}>
        Review items
      </Link>
      {next ? <NextDeadlineRow next={next} /> : null}
    </div>
  );
}

export async function HeroExposure() {
  const { db, companyId } = await getCtx();
  const [exp, dl, review, drafts, ready] = await Promise.all([
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
  ]);
  const states = [...exp.byState].sort((a, b) => b.cents - a.cents);
  const actions: NextAction[] = [
    { href: "/approvals", n: drafts[0]?.n ?? 0, one: "draft awaiting approval", many: "drafts awaiting approval" },
    { href: "/items?review=1", n: review.total, one: "item needs review", many: "items need review" },
    { href: "/reports", n: ready[0]?.n ?? 0, one: "report ready to file", many: "reports ready to file" },
  ].filter((a) => a.n > 0);
  return (
    <>
      <section aria-label="Total exposure" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="min-w-0">
          <p className="text-[13px] text-fg-2">At risk today</p>
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
          <StateBar states={states} total={exp.totalCents} />
        </div>
        <NeedsYou actions={actions} next={dl.events.find((e) => e.daysUntil >= 0) ?? null} />
      </section>
      {exp.anyUnverified ? <UnverifiedBanner className="mt-10" /> : null}
    </>
  );
}
