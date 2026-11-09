import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { SyntheticChip, UnverifiedBanner } from "@/components/primitives";
import { LoopBar } from "@/components/shell/LoopBar";
import { MoneyMap } from "@/components/viz/money-map/MoneyMap";
import { loadClockHistory } from "@/lib/clock-history";
import { now } from "@/lib/clock";
import { formatUSD } from "@/lib/money";
import { ACTIVITY_KIND_LABEL, listActivity } from "@/lib/queries/activity";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";
import { formatShortDay } from "../activity/format";
import { CfoBriefButton } from "./cfo-brief-button";
import { loadDashboard } from "./data";
import { MapLegend } from "./map-legend";
import { NeedsYou } from "./needs-you";
import { DashboardOverdue } from "./overdue";

/**
 * Below the dashboard stage (docs/DESIGN-V4.md §7): a few calm sections, one idea each, each with a one-line
 * plain-English explanation. Everything denser lives behind "More detail" (or on its own page).
 */

const LINK = "group inline-flex items-center gap-1 rounded-sm text-[14px] font-medium text-fg-1 underline-offset-4 hover:underline";

function Arrow() {
  return (
    <ArrowUpRight
      className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

interface DashSectionProps {
  id: string;
  title: string;
  /** One plain-English line: what this section tells you. */
  lede: ReactNode;
  action?: ReactNode;
  testId?: string;
  tour?: string;
  children: ReactNode;
}

/** One idea per section: a light display title, one muted sentence, then the content. */
export function DashSection({ id, title, lede, action, testId, tour, children }: DashSectionProps) {
  return (
    <section aria-labelledby={id} data-testid={testId} data-tour={tour} className="mt-24 min-w-0 scroll-mt-20">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-fg-1/[0.12] pt-7">
        <div className="min-w-0">
          <h2 id={id} className="type-display text-[clamp(1.75rem,1.1rem+1.7vw,2.75rem)] leading-[1.02] tracking-[-0.035em] text-fg-1">
            {title}
          </h2>
          <p className="mt-2 max-w-xl text-[15px] leading-6 text-fg-2">{lede}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The core loop counts and the CFO brief, in one quiet row right under the stage. */
export function LoopRow() {
  return (
    <div className="mt-14 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div data-testid="loop-slot" className="min-w-0 flex-1">
        <LoopBar placement="page" />
      </div>
      <div data-testid="cfo-brief-row" className="flex shrink-0 items-center gap-3">
        <CfoBriefButton />
      </div>
    </div>
  );
}

/** Section 1: the 3D Money Map (lazy, static fallback, reduced motion) and the same totals as plain numbers. */
export async function WhereTheMoneyIs() {
  const d = await loadDashboard();
  const states = d.mapStates;
  return (
    <DashSection
      id="where-h"
      title="Where the money is"
      lede="Each column is what you owe the owners in one state. Taller means more money; a coral ring means a deadline there is close or past."
      action={<SyntheticChip />}
      tour="states"
    >
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <MoneyMap
            states={states}
            hqState={d.company.incorporationState}
            recovered={d.flow.recoveredByState.map((r) => ({ ...r, formatted: formatUSD(r.cents) }))}
            legend={<MapLegend d={d} />}
          />
        </div>
        <ul aria-label="Owed by state" className="flex min-w-0 flex-col gap-2 lg:col-span-4 lg:self-center">
          {states.map((s) => (
            <li key={s.state}>
              <Link
                href={s.href}
                className="group glass flex items-end justify-between gap-4 rounded-[18px] px-5 py-4 transition-[background-color,border-color] duration-150 hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="type-label block">
                    {s.state} · <span className="num">{s.count}</span> {s.count === 1 ? "item" : "items"}
                  </span>
                  <span className="num mt-1 block text-[30px] leading-none font-light tracking-[-0.035em] text-fg-1">{s.short}</span>
                </span>
                {s.late > 0 ? (
                  <span className="mb-1 inline-flex h-5 items-center rounded-full bg-pink-500 px-2 text-[11px] font-medium whitespace-nowrap text-black">
                    {s.late} late
                  </span>
                ) : (
                  <ArrowUpRight className="mb-1 size-4 text-fg-3 transition-colors group-hover:text-fg-1" strokeWidth={1.5} aria-hidden />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </DashSection>
  );
}

/** Section 2: what is due next (overdue first), next to what is waiting on a person. */
export async function DueNext({ deadlines }: { deadlines: ReactNode }) {
  const d = await loadDashboard();
  return (
    <DashSection
      id="due-h"
      title="What is due next"
      lede="Dates come from the versioned state rules, never from the model. Late items come first, then the next 90 days."
      testId="due-next"
    >
      <DashboardOverdue summary={d.overdue} lateMoney={d.lateMoney} />
      <div className="grid gap-x-8 gap-y-8 lg:grid-cols-12">
        <div className="glass min-w-0 rounded-[22px] p-5 lg:col-span-7 [&>section]:border-t-0 [&>section]:pt-0">{deadlines}</div>
        <div className="min-w-0 lg:col-span-5">
          <NeedsYou d={d} />
        </div>
      </div>
      {d.exposure.anyUnverified ? <UnverifiedBanner className="mt-8" /> : null}
    </DashSection>
  );
}

const RECENT = 5;

/** Section 3: the last few things the agent or a person did, straight from the audit timeline. */
export async function RecentActivity() {
  const { db, companyId } = await getCtx();
  const [today, history] = await Promise.all([now(db, companyId), loadClockHistory(db, companyId)]);
  const { entries } = await listActivity(db, companyId, { limit: RECENT, clock: { history, today } });
  return (
    <DashSection
      id="recent-h"
      title="Recent activity"
      lede="What the agent and your team did last. Every entry is a real record in the audit trail."
      testId="recent-activity"
      action={
        <Link href="/activity" className={LINK}>
          All activity
          <Arrow />
        </Link>
      }
    >
      {entries.length === 0 ? (
        <p className="glass rounded-[22px] px-5 py-6 text-[14px] text-fg-2">Nothing has happened yet. Activity shows here once the agent or a person acts.</p>
      ) : (
        <ol className="glass divide-y divide-fg-1/[0.08] overflow-hidden rounded-[22px]">
          {entries.map((e) => (
            <li key={e.id}>
              <Link
                href={e.href}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-5 py-3.5 transition-colors duration-150 hover:bg-fg-1/[0.05] sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]"
              >
                <span className="num text-[13px] text-fg-3 max-sm:col-span-2">{formatShortDay(e.demoDay)}</span>
                <span className="min-w-0 truncate text-[14px] text-fg-1">
                  {e.title}
                  {e.detail ? <span className="text-fg-3"> · {e.detail}</span> : null}
                </span>
                <span className={cn("text-xs whitespace-nowrap", e.attention ? "text-pink-300" : "text-fg-3")}>{ACTIVITY_KIND_LABEL[e.kind]}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </DashSection>
  );
}

/** Everything else, folded: the money flow, status breakdown, audit interest and a sample check's lifecycle. */
export function MoreDetail({ children }: { children: ReactNode }) {
  return (
    <details data-testid="dash-more" className="group/more mt-24 border-t border-fg-1/[0.12] pt-7">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="type-display block text-[clamp(1.5rem,1.1rem+1.1vw,2.1rem)] leading-[1.05] tracking-[-0.03em] text-fg-1">More detail</span>
          <span className="mt-1.5 block text-[15px] text-fg-2">How the money moves, items by status, audit interest, and one check from start to finish.</span>
        </span>
        <span className="glass-pill inline-grid size-10 shrink-0 place-items-center text-fg-2">
          <ChevronDown className="size-5 transition-transform duration-200 group-open/more:rotate-180" strokeWidth={1.5} aria-hidden />
        </span>
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
