import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  DateCell,
  EmptyState,
  Hint,
  Money,
  Section,
  StatusDot,
  StatusPill,
  UnknownBadge,
  UnverifiedBadge,
  STALE_STATUS_ORDER,
} from "@/components/primitives";
import { AddToCalendar } from "@/components/forecast/AddToCalendar";
import { InView } from "@/components/motion";
import { LifecycleRail } from "@/components/viz/core";
import { buttonVariants } from "@/components/ui/button";
import { diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_LABEL, formatDate, formatSpan, plural, PROPERTY_TYPE_LABEL } from "@/lib/format";
import { DueChip, SOON_DAYS } from "./DueChip";
import { formatUSD } from "@/lib/money";
import { explainItem, getAuditInterestExposure, getExposure, getFeaturedItem, getStatusCounts, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";

/** Pink = a person is needed within 7 days (§1.2), the same window as the Money Map's gate rings. */
const NEAR_DAYS = 7;
/** Today plus the next 90 days. */
const DAYS = 91;
const HORIZON = DAYS - 1;

const LINK_CLASS = "inline-flex items-center gap-1 rounded-sm text-[13px] text-fg-2 transition-colors duration-150 hover:text-fg-1";

interface DayEvent {
  kind: string;
  payeeName: string;
  state: string | null;
  cents: number;
}

const MAX_TIP_ROWS = 3;

/** What one day of the strip holds, as a tooltip: up to three deadlines with their amounts. */
function DayTip({ iso, events }: { iso: string; events: DayEvent[] }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">
        {formatDate(iso)}, {events.length} {events.length === 1 ? "deadline" : "deadlines"}
      </span>
      {events.slice(0, MAX_TIP_ROWS).map((e, i) => (
        <span key={i} className="flex justify-between gap-4 opacity-90">
          <span className="min-w-0 truncate">
            {DEADLINE_LABEL[e.kind] ?? e.kind}, {e.payeeName}
            {e.state ? `, ${e.state}` : ""}
          </span>
          <span className="num shrink-0">{formatUSD(e.cents)}</span>
        </span>
      ))}
      {events.length > MAX_TIP_ROWS ? <span className="opacity-80">and {events.length - MAX_TIP_ROWS} more</span> : null}
    </span>
  );
}

/**
 * 90-day strip, one column per day. Days with deadlines rise; the first two weeks are pink (needs a human soon),
 * later ones blue. Each day with a deadline is focusable and names its deadlines on hover or focus, and the caption
 * says how to read it. Month starts get a label so the strip reads as a calendar, not a decoration.
 */
function DayStrip({ asOf, days }: { asOf: string; days: DayEvent[][] }) {
  const max = Math.max(1, ...days.map((d) => d.length));
  const total = days.reduce((a, d) => a + d.length, 0);
  const near = days.slice(0, NEAR_DAYS + 1).reduce((a, d) => a + d.length, 0);
  const months = days
    .map((_, i) => ({ i, iso: addDaysIso(asOf, i) }))
    .filter(({ i, iso }) => i > 3 && iso.endsWith("-01"));
  return (
    <InView as="figure" className="mb-6" data-testid="deadline-strip">
      <figcaption className="sr-only">
        {plural(total, "deadline")} in the next {HORIZON} days; {near} within {NEAR_DAYS} days. Each marked day lists its deadlines.
      </figcaption>
      <div className="group/strip relative flex h-14 items-end gap-px">
        {/* the 7-day window, shaded pink-900 */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 rounded-[2px] bg-pink-900/60" style={{ width: `${((NEAR_DAYS + 1) / DAYS) * 100}%` }} />
        {days.map((events, i) => {
          if (events.length === 0) {
            return (
              <div key={i} aria-hidden className="flex h-full flex-1 items-end">
                <div className={cn("w-full", i % 7 === 0 ? "h-1.5 bg-line-strong" : "h-1 bg-line-hover")} />
              </div>
            );
          }
          const iso = addDaysIso(asOf, i);
          return (
            <Hint
              key={i}
              content={<DayTip iso={iso} events={events} />}
              className="group/day relative -my-1 flex h-[calc(100%+0.5rem)] min-w-[3px] flex-1 items-end py-1 outline-offset-1"
            >
              <span className="sr-only">
                {formatDate(iso)}: {events.length} {events.length === 1 ? "deadline" : "deadlines"}
              </span>
              <span
                aria-hidden
                className={cn(
                  "es-iv-grow-y block w-full origin-bottom rounded-t-[1px] transition-opacity duration-150 group-hover/strip:opacity-45 group-hover/day:!opacity-100 group-focus-visible/day:!opacity-100",
                  i <= NEAR_DAYS ? "bg-pink-500" : "bg-blue-500",
                )}
                style={{ height: `${Math.max(30, (events.length / max) * 100)}%`, ["--i" as string]: Math.min(i, 12) }}
              />
            </Hint>
          );
        })}
      </div>
      <div aria-hidden className="relative mt-2 h-4 text-xs text-fg-3">
        <span className="absolute left-0">Today</span>
        {months.map(({ i, iso }) => (
          <span key={iso} className="absolute -translate-x-1/2 max-sm:hidden" style={{ left: `${((i + 0.5) / days.length) * 100}%` }}>
            {formatDate(iso, { year: false }).replace(/ 1$/, "")}
          </span>
        ))}
        <span className="absolute right-0">{formatDate(addDaysIso(asOf, days.length - 1), { year: false })}</span>
      </div>
      <p aria-hidden className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-pink-500" />
          Within 7 days
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-blue-500" />
          Later
        </span>
        <span className="max-sm:hidden">Bar height is the number of deadlines that day. Hover or focus a bar for details.</span>
      </p>
    </InView>
  );
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function DeadlinesPanel() {
  const { db, companyId } = await getCtx();
  const { asOf, events } = await upcomingDeadlines(db, companyId, 90);
  if (events.length === 0) {
    return (
      <Section title="Next deadlines">
        <EmptyState title="No deadlines in the next 90 days" description="Move the demo clock forward to see upcoming report and due-diligence dates." />
      </Section>
    );
  }
  const days: DayEvent[][] = Array.from({ length: DAYS }, (_, i) =>
    events
      .filter((e) => Math.max(0, Math.min(DAYS - 1, e.daysUntil)) === i)
      .map((e) => ({ kind: e.kind, payeeName: e.payeeName, state: e.state, cents: e.amount.cents })),
  );
  const near = events.filter((e) => e.daysUntil <= NEAR_DAYS).length;
  const shown = events.slice(0, 5);
  return (
    <Section
      title="Next deadlines"
      meta={
        <>
          <span className="num">{events.length}</span> in 90 days
          {near > 0 ? (
            <>
              , <span className="num text-pink-400">{near}</span> <span className="text-pink-400">within {NEAR_DAYS} days</span>
            </>
          ) : null}
        </>
      }
      action={
        <span className="flex items-center gap-3">
          <AddToCalendar size="sm" />
          <Link href="/items?sort=deadline_asc" className={cn(LINK_CLASS, "max-sm:hidden")}>
            All deadlines
          </Link>
        </span>
      }
    >
      <DayStrip asOf={asOf} days={days} />
      <ul className="-mx-2">
        {shown.map((e, i) => (
          <li key={`${e.itemId}-${e.kind}`} className="es-rise" style={{ ["--i" as string]: i }}>
            <Link
              href={`/items?item=${e.itemId}`}
              className="grid grid-cols-[3rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-[6px] px-2 py-2 transition-colors duration-150 hover:bg-ink-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto_5.5rem]"
            >
              <span className="num text-[13px] text-fg-2">{formatDate(e.date, { year: false })}</span>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[13px] font-medium text-fg-1">{e.payeeName}</span>
                <span className="hidden shrink-0 text-[13px] text-fg-3 md:inline">
                  {DEADLINE_LABEL[e.kind]}, {e.state ?? "state unknown"}
                </span>
                {!e.verified ? <UnverifiedBadge compact className="shrink-0 self-center" /> : null}
              </span>
              <Money cents={e.amount.cents} className="justify-self-end text-[13px] text-fg-1" />
              <span className={cn("justify-self-end", e.daysUntil > SOON_DAYS && "max-sm:hidden")}>
                <DueChip days={e.daysUntil} kind={e.kind} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {events.length > shown.length ? (
        <p className="mt-2 text-[13px] text-fg-3">
          <span className="num">{events.length - shown.length}</span> more in the next 90 days.
        </p>
      ) : null}
    </Section>
  );
}

/** One-line meaning of each item status. */
const STATUS_HINT: Record<string, string> = {
  watching: "Outstanding, not yet in a due-diligence window",
  dd_pending: "Due-diligence letter is due now",
  dd_sent: "Letter mailed, waiting on the owner",
  owner_responded: "Owner answered; confirm payment",
  resolved_paid: "Owner was paid; nothing to report",
  to_report: "Goes on the next state report",
  reported: "Filed with the state",
  remitted: "Funds sent to the state",
  needs_rule: "A rule value is missing, so dates are unknown",
};

/** The Money Flow names a resolved item "Resolved with owner"; By status uses the same words (R6-16). */
const STATUS_LABEL: Record<string, string> = { resolved_paid: "Resolved with owner" };

export async function StatusPanel() {
  const { db, companyId } = await getCtx();
  const counts = await getStatusCounts(db, companyId);
  const byStatus = new Map(counts.map((c) => [c.status as string, c]));
  const total = counts.reduce((a, c) => a + c.count, 0);
  const rows = STALE_STATUS_ORDER.map((s) => ({ status: s, c: byStatus.get(s) })).filter((r) => r.c && r.c.count > 0);
  return (
    <Section title="By status" meta={<><span className="num">{total}</span> items</>}>
      {rows.length === 0 ? (
        <EmptyState title="No items yet" description="Seed the demo data or upload a check register in Settings." />
      ) : (
        <ul className="-mx-2">
          {rows.map(({ status, c }) => (
            <li key={status}>
              <Link
                href={`/items?status=${status}`}
                className="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-baseline gap-x-4 rounded-[6px] px-2 py-2 transition-colors duration-150 hover:bg-ink-2"
              >
                <span className="min-w-0">
                  <StatusDot status={status} withLabel label={STATUS_LABEL[status]} className="text-[13px]" />
                  {STATUS_HINT[status] ? <span className="mt-0.5 block truncate pl-3.5 text-xs text-fg-3">{STATUS_HINT[status]}</span> : null}
                </span>
                <span className="num text-[13px] text-fg-3">{formatUSD(c!.cents)}</span>
                <span className="num text-right text-[13px] font-medium text-fg-1">{c!.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export async function FeaturedItem() {
  const { db, companyId } = await getCtx();
  const item = await getFeaturedItem(db, companyId);
  if (!item) {
    return (
      <Section title="Featured item">
        <EmptyState title="Check #10482 is not in this dataset" description="Reset the demo data to load the featured Bayline Electric check." />
      </Section>
    );
  }
  const ex = await explainItem(db, item.id);
  const nd = item.nextDeadline;
  const days = nd ? diffDays(ex?.asOf as IsoDate, nd.date as IsoDate) : null;
  const timeline = ex?.timeline ?? [];
  const isClosed = item.status === "resolved_paid" || item.status === "remitted";
  const basis =
    item.ownerStateBasis === "incorporation" ? "state of incorporation" : item.ownerStateBasis === "address" ? "last known address" : "unknown basis";
  return (
    <section aria-label="Featured item" className="glass rounded-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[13px] text-fg-3">
            Featured check <span className="font-mono text-fg-2">#{item.checkNumber}</span>
          </p>
          <h2 className="mt-1 truncate text-lg font-medium tracking-[-0.01em] text-fg-1">{item.payeeName}</h2>
        </div>
        <div className="text-right">
          <Money cents={item.amount.cents} className="text-2xl font-medium tracking-[-0.02em] text-fg-1" />
          <div className="mt-1.5 flex justify-end">
            <StatusPill status={item.status} />
          </div>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 px-5 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-fg-3">Issued</dt>
          <dd className="mt-0.5 text-fg-1">
            <span className="num">{formatSpan(item.ageDays)}</span> ago, {PROPERTY_TYPE_LABEL[item.propertyType]?.toLowerCase()}
          </dd>
        </div>
        <div>
          <dt className="text-fg-3">Owner state</dt>
          <dd className="mt-0.5 text-fg-1">
            {item.ownerState ?? "Unknown"} <span className="text-fg-3">by {basis}</span>
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-fg-3">Next deadline</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-1">
            {isClosed ? (
              <span className="text-fg-2">None. {item.status === "remitted" ? "Funds were remitted to the state." : "The owner was paid, so nothing goes to the state."}</span>
            ) : nd ? (
              <>
                <DateCell date={nd.date} />
                <span className="text-fg-3">{DEADLINE_LABEL[nd.kind]}</span>
                {days !== null ? <DueChip days={days} kind={nd.kind} /> : null}
                {!nd.verified ? <UnverifiedBadge /> : null}
              </>
            ) : (
              <UnknownBadge />
            )}
          </dd>
        </div>
      </dl>
      {timeline.length > 0 && ex ? (
        <div className="relative mt-5 overflow-x-clip border-t border-line px-5 pt-4" data-testid="featured-timeline">
          <LifecycleRail
            title={`Lifecycle, today is ${formatDate(ex.asOf)}`}
            asOf={ex.asOf}
            issueDate={ex.ledger.lastActivityDate ?? ex.ledger.issueDate}
            staleSince={ex.item.staleSince}
            events={timeline.map((t) => ({ key: t.key, label: t.label, date: t.date, status: t.status, verified: t.verified, ruleVersion: t.ruleVersion, rulePaths: t.rulePaths }))}
          />
        </div>
      ) : null}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="text-xs text-fg-3">Every date cites the rule it came from.</span>
        <Link href={`/items?item=${item.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          View timeline
          <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

const NO_RULE_TIP = "No interest rule for this state yet, so the engine does not compute a number. It never estimates one.";

/** A missing value that reads as a known gap, not an error: hollow ring, plain text, an explanation on hover. */
function NoRule() {
  return (
    <Hint content={NO_RULE_TIP} className="inline-flex rounded-sm">
      <span data-testid="unknown-badge" className="inline-flex items-center gap-1.5 text-[13px] text-fg-3">
        <span aria-hidden className="size-2 shrink-0 rounded-full ring-[1.5px] ring-fg-3 ring-inset" />
        No rule yet
      </span>
    </Hint>
  );
}

const listStates = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export async function AuditInterest() {
  const { db, companyId } = await getCtx();
  const [ai, exp] = await Promise.all([getAuditInterestExposure(db, companyId), getExposure(db, companyId)]);
  const unknown = ai.byState.filter((s) => s.status === "unknown").map((s) => s.state);
  const known = ai.byState.filter((s) => s.status === "ok" && s.interest);
  const knownCents = known.reduce((a, s) => a + s.interest!.cents, 0);
  const pct = ai.total && exp.totalCents > 0 ? Math.min(100, (ai.total.cents / exp.totalCents) * 100) : 0;
  return (
    <Section title="Audit-interest exposure" action={ai.anyUnverified ? <UnverifiedBadge /> : null}>
      <p className="mb-5 max-w-prose text-[13px] text-fg-2">
        Interest a state auditor could add if items go unreported. Computed only where a state has an interest rule; a missing rule stays missing.
      </p>
      {ai.total ? (
        <div className="mb-5">
          <div className="flex items-baseline gap-3">
            <Money cents={ai.total.cents} className="text-[28px] font-medium tracking-[-0.02em] text-fg-1" />
            <span className="text-[13px] text-fg-3">on {exp.total.formatted} principal</span>
          </div>
          <div className="mt-3 h-1 rounded-full bg-ink-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Interest as a share of principal">
            <div className="es-grow-x h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : unknown.length > 0 ? (
        <div className="mb-5 rounded-lg border border-line bg-ink-2 px-4 py-3.5" data-testid="interest-gap">
          <p className="flex items-center gap-2 text-[15px] font-medium text-fg-1">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full ring-[1.5px] ring-fg-3 ring-inset" />
            No total yet
          </p>
          <p className="mt-1.5 text-[13px] text-pretty text-fg-2">
            {listStates(unknown)} {unknown.length === 1 ? "has" : "have"} no interest rule, so any total would understate the exposure.
            {known.length > 0 ? (
              <>
                {" "}
                The {known.length === 1 ? "state" : "states"} with a rule ({listStates(known.map((s) => s.state))}) come to{" "}
                <Money cents={knownCents} className="text-fg-1" />.
              </>
            ) : null}
          </p>
          <Link href="/rules" className={cn(LINK_CLASS, "mt-2.5 text-blue-400 hover:text-blue-300")}>
            Add the missing {unknown.length === 1 ? "rule" : "rules"} in Rules
            <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      ) : null}
      <table className="w-full text-[13px]">
        <thead className="sr-only">
          <tr>
            <th scope="col">State</th>
            <th scope="col">Items and principal</th>
            <th scope="col">Interest</th>
          </tr>
        </thead>
        <tbody>
          {ai.byState.map((s) => (
            <tr key={s.state} className="border-t border-line">
              <td className="w-10 py-2.5 font-medium text-fg-1">{s.state}</td>
              <td className="py-2.5 text-fg-3">
                <span className="num">{s.itemCount}</span> items, {s.principal.formatted.replace(/\.\d{2}$/, "")}
              </td>
              <td className="py-2.5 text-right">
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  {s.status === "unknown" ? <NoRule /> : <Money cents={s.interest!.cents} className="text-fg-1" />}
                  {s.status === "ok" && !s.verified ? <UnverifiedBadge compact /> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
