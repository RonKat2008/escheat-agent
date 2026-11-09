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
 * Below the dashboard stage (docs/DESIGN-V4.md §7, docs/ASK-MODE.md slice 5): a view-only overview with two calm
 * sections, one idea each (where the money is, what is due next), each with a one-line plain-English explanation.
 * Everything denser (the core loop counts, recent activity, the money flow, status, audit interest, one check's
 * lifecycle) lives behind the closed "More detail" fold or on its own page. Questions Ask answers today are
 * "Do it in Ask" links (src/lib/ask/ask-link.ts); everything else links to the page that does it.
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
  className?: string;
  children: ReactNode;
}

/** One idea per section: a light display title, one muted sentence, then the content. */
export function DashSection({ id, title, lede, action, testId, tour, className, children }: DashSectionProps) {
  return (
    <section aria-labelledby={id} data-testid={testId} data-tour={tour} data-dash-section={id} className={cn("mt-24 min-w-0 scroll-mt-20", className)}>
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

export interface AskTarget {
  href: string;
  prompt: string;
}

/**
 * "Do it in Ask": sends `prompt` as a new Ask conversation (`/ask?q=…`). Only rendered for an href from `askLinkFor`,
 * i.e. a prompt Ask answers today; the accessible name and the tooltip carry the exact question.
 */
export function AskLink({ href, prompt }: AskTarget) {
  return (
    <Link href={href} data-testid="do-in-ask" data-prompt={prompt} title={`Ask: ${prompt}`} aria-label={`Do it in Ask: ${prompt}`} className={LINK}>
      Do it in Ask
      <Arrow />
    </Link>
  );
}

/** One quiet row under the stage: the CFO brief download (a file, not an action). */
export function BriefRow() {
  return (
    <div data-testid="cfo-brief-row" className="mt-14 flex items-center justify-end gap-4">
      <span className="text-[13px] text-fg-2 max-sm:hidden">The same numbers on one page, for your CFO or audit committee.</span>
      <CfoBriefButton />
    </div>
  );
}

/** The core loop counts (Triage, Draft, Approve, File): the first thing inside "More detail". */
export function LoopSlot() {
  return (
    <div data-testid="loop-slot" className="min-w-0">
      <LoopBar placement="page" />
    </div>
  );
}

/** Section 1: the 3D Money Map (lazy, static fallback, reduced motion) and the same totals as plain numbers. */
export async function WhereTheMoneyIs({ ask = null }: { ask?: AskTarget | null }) {
  const d = await loadDashboard();
  const states = d.mapStates;
  return (
    <DashSection
      id="where-h"
      title="Where the money is"
      lede="One column per state. Taller means you owe more there; a coral ring means a deadline there is close or past."
      action={
        <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <SyntheticChip />
          {ask ? <AskLink {...ask} /> : null}
        </span>
      }
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
export async function DueNext({ deadlines, ask = null }: { deadlines: ReactNode; ask?: AskTarget | null }) {
  const d = await loadDashboard();
  return (
    <DashSection
      id="due-h"
      title="What is due next"
      lede="Late items first, then the next 90 days. Every date comes from the state rules, never from the model."
      testId="due-next"
      action={ask ? <AskLink {...ask} /> : null}
    >
      <DashboardOverdue summary={d.overdue} lateMoney={d.lateMoney} />
      <div className="grid gap-x-8 gap-y-8 lg:grid-cols-12">
        <div className="glass min-w-0 rounded-[22px] p-5 lg:col-span-7 [&>section]:border-t-0 [&>section]:pt-0">{deadlines}</div>
        <div className="min-w-0 lg:col-span-5">
          <NeedsYou d={d} askDeadlines={ask?.href ?? null} />
        </div>
      </div>
      {d.exposure.anyUnverified ? <UnverifiedBanner className="mt-8" /> : null}
    </DashSection>
  );
}

const RECENT = 5;

/** Section 3: the last few things the agent or a person did, straight from the audit timeline. */
export async function RecentActivity({ className }: { className?: string }) {
  const { db, companyId } = await getCtx();
  const [today, history] = await Promise.all([now(db, companyId), loadClockHistory(db, companyId)]);
  const { entries } = await listActivity(db, companyId, { limit: RECENT, clock: { history, today } });
  return (
    <DashSection
      id="recent-h"
      title="Recent activity"
      lede="What the agent and your team did last. Every entry is a real record in the audit trail."
      testId="recent-activity"
      className={className}
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

/** Everything else, folded (closed by default): loop counts, recent activity, money flow, status, audit interest, one check. */
export function MoreDetail({ children }: { children: ReactNode }) {
  return (
    <details data-testid="dash-more" className="group/more mt-24 border-t border-fg-1/[0.12] pt-7">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="type-display block text-[clamp(1.5rem,1.1rem+1.1vw,2.1rem)] leading-[1.05] tracking-[-0.03em] text-fg-1">More detail</span>
          <span className="mt-1.5 block text-[15px] text-fg-2">The core loop, recent activity, how the money moves, items by status, audit interest, and one check from start to finish.</span>
        </span>
        <span className="glass-pill inline-grid size-10 shrink-0 place-items-center text-fg-2">
          <ChevronDown className="size-5 transition-transform duration-200 group-open/more:rotate-180" strokeWidth={1.5} aria-hidden />
        </span>
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
