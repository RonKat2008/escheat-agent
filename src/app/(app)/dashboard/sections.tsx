import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  DateCell,
  EmptyState,
  Money,
  Section,
  StatusDot,
  StatusPill,
  UnknownBadge,
  UnverifiedBadge,
  STALE_STATUS_ORDER,
} from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_LABEL, formatDate, formatSpan, PROPERTY_TYPE_LABEL, relativeDays } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { explainItem, getAuditInterestExposure, getExposure, getFeaturedItem, getStatusCounts, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";

const SOON_DAYS = 7;
const NEAR_DAYS = 14;
const DAYS = 91;

const TL_SHORT: Record<string, string> = {
  presumed_abandoned: "Abandoned",
  dd_window_start: "DD opens",
  dd_window_end: "DD closes",
  report_due: "Report due",
  remit_due: "Remit due",
};

const LINK_CLASS = "inline-flex items-center gap-1 rounded-sm text-[13px] text-fg-2 transition-colors duration-150 hover:text-fg-1";

/** Relative time: a pink pill only when it is close enough to need a human. */
function DueIn({ days }: { days: number }) {
  if (days <= SOON_DAYS) {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-pink-500 px-2 text-xs font-medium whitespace-nowrap text-black">
        {days <= 0 ? "Due today" : `Due ${relativeDays(days)}`}
      </span>
    );
  }
  return <span className="text-[13px] whitespace-nowrap text-fg-3">{relativeDays(days)}</span>;
}

/**
 * 90-day strip, one column per day. Days with deadlines rise; the first two weeks are pink (needs a human soon),
 * later ones blue. Month starts get a label so the strip reads as a calendar, not a decoration.
 */
function DayStrip({ asOf, perDay }: { asOf: string; perDay: number[] }) {
  const max = Math.max(1, ...perDay);
  const total = perDay.reduce((a, n) => a + n, 0);
  const months = perDay
    .map((_, i) => ({ i, iso: addDaysIso(asOf, i) }))
    .filter(({ i, iso }) => i > 3 && iso.endsWith("-01"));
  return (
    <div role="img" aria-label={`${total} deadlines over the next ${DAYS} days; ${perDay.slice(0, NEAR_DAYS + 1).reduce((a, n) => a + n, 0)} within two weeks`} className="mb-6">
      <div className="relative flex h-14 items-end gap-px">
        {perDay.map((n, i) => (
          <div key={i} className="flex h-full flex-1 items-end">
            {n === 0 ? (
              <div className={cn("w-full", i % 7 === 0 ? "h-1.5 bg-line-strong" : "h-1 bg-line-hover")} />
            ) : (
              <div
                className={cn("es-grow-y w-full min-w-[3px] rounded-t-[1px]", i <= NEAR_DAYS ? "bg-pink-500" : "bg-blue-500")}
                style={{ height: `${Math.max(30, (n / max) * 100)}%`, ["--i" as string]: Math.min(i, 12) }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="relative mt-2 h-4 text-xs text-fg-3">
        <span className="absolute left-0">Today</span>
        {months.map(({ i, iso }) => (
          <span key={iso} className="absolute -translate-x-1/2 max-sm:hidden" style={{ left: `${((i + 0.5) / perDay.length) * 100}%` }}>
            {formatDate(iso, { year: false }).replace(/ 1$/, "")}
          </span>
        ))}
        <span className="absolute right-0">{formatDate(addDaysIso(asOf, perDay.length - 1), { year: false })}</span>
      </div>
    </div>
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
  const perDay = Array.from({ length: DAYS }, () => 0);
  for (const e of events) perDay[Math.max(0, Math.min(DAYS - 1, e.daysUntil))]!++;
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
              , <span className="num text-pink-400">{near}</span> <span className="text-pink-400">within 2 weeks</span>
            </>
          ) : null}
        </>
      }
      action={
        <Link href="/items?sort=deadline_asc" className={LINK_CLASS}>
          All deadlines
        </Link>
      }
    >
      <DayStrip asOf={asOf} perDay={perDay} />
      <ul className="-mx-2">
        {shown.map((e, i) => (
          <li key={`${e.itemId}-${e.kind}`} className="es-rise" style={{ ["--i" as string]: i }}>
            <Link
              href={`/items?item=${e.itemId}`}
              className="grid grid-cols-[3rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-ink-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto_5.5rem]"
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
                <DueIn days={e.daysUntil} />
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
                className="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-baseline gap-x-4 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-ink-2"
              >
                <span className="min-w-0">
                  <StatusDot status={status} withLabel className="text-[13px]" />
                  {STATUS_HINT[status] ? <span className="mt-0.5 block truncate pl-3.5 text-xs text-fg-3">{STATUS_HINT[status]}</span> : null}
                </span>
                <span className="num text-[13px] text-fg-3">{formatUSD(c!.cents).replace(/\.\d{2}$/, "")}</span>
                <span className="num text-right text-[13px] font-medium text-fg-1">{c!.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function nodeClass(isNext: boolean, isPast: boolean): string {
  if (isNext) return "bg-ink-0 ring-2 ring-pink-500";
  if (isPast) return "bg-blue-500";
  return "bg-ink-0 ring-1 ring-fg-4";
}

export async function FeaturedItem() {
  const { db, companyId } = await getCtx();
  const item = await getFeaturedItem(db, companyId);
  if (!item) {
    return (
      <Section title="Featured item">
        <EmptyState title="Check #10482 is not in this dataset" description="Run pnpm seed:demo to load the featured Bayline Electric check." />
      </Section>
    );
  }
  const ex = await explainItem(db, item.id);
  const nd = item.nextDeadline;
  const days = nd ? diffDays(ex?.asOf as IsoDate, nd.date as IsoDate) : null;
  const timeline = ex?.timeline ?? [];
  const isClosed = item.status === "resolved_paid" || item.status === "remitted";
  const nextKey = isClosed ? undefined : timeline.find((t) => t.date && t.date >= (ex?.asOf ?? ""))?.key;
  const basis =
    item.ownerStateBasis === "incorporation" ? "state of incorporation" : item.ownerStateBasis === "address" ? "last known address" : "unknown basis";
  return (
    <section aria-label="Featured item" className="rounded-xl border border-line bg-ink-2">
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
          <dt className="text-fg-3">Next legal date</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-1">
            {isClosed ? (
              <span className="text-fg-2">None. {item.status === "remitted" ? "Funds were remitted to the state." : "The owner was paid, so nothing goes to the state."}</span>
            ) : nd ? (
              <>
                <DateCell date={nd.date} />
                <span className="text-fg-3">{DEADLINE_LABEL[nd.kind]}</span>
                {days !== null && days <= SOON_DAYS ? <DueIn days={days} /> : days !== null ? <span className="text-fg-3">{relativeDays(days)}</span> : null}
                {!nd.verified ? <UnverifiedBadge /> : null}
              </>
            ) : (
              <UnknownBadge />
            )}
          </dd>
        </div>
      </dl>
      {timeline.length > 0 ? (
        <ol className="mt-6 grid gap-y-3 border-t border-line px-5 pt-5 sm:grid-cols-5 sm:gap-y-0" aria-label="Timeline">
          {timeline.map((t, i) => {
            const isPast = Boolean(t.date && ex && t.date < ex.asOf);
            const isNext = t.key === nextKey;
            return (
              <li key={t.key} className="flex min-w-0 items-center gap-3 sm:block">
                <div className="flex items-center sm:mb-2.5">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", nodeClass(isNext, isPast))} />
                  {i < timeline.length - 1 ? (
                    <span aria-hidden className={cn("mx-1.5 hidden h-px flex-1 sm:block", isPast ? "bg-blue-500/50" : "bg-line-hover")} />
                  ) : null}
                </div>
                <div className={cn("num w-24 shrink-0 text-xs sm:w-auto sm:truncate", isNext ? "text-fg-1" : "text-fg-2")}>
                  {t.date ? formatDate(t.date) : <span className="text-fg-3 italic">Unknown</span>}
                </div>
                <div className="truncate text-xs text-fg-3 sm:pr-2" title={t.label}>
                  {TL_SHORT[t.key] ?? t.label}
                  {isNext ? <span className="text-pink-400 sm:hidden"> (next)</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
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

export async function AuditInterest() {
  const { db, companyId } = await getCtx();
  const [ai, exp] = await Promise.all([getAuditInterestExposure(db, companyId), getExposure(db, companyId)]);
  const allUnknown = ai.byState.length > 0 && ai.byState.every((s) => s.status === "unknown");
  const pct = ai.total && exp.totalCents > 0 ? Math.min(100, (ai.total.cents / exp.totalCents) * 100) : 0;
  return (
    <Section title="Audit-interest exposure" action={ai.anyUnverified ? <UnverifiedBadge /> : null}>
      <p className="mb-5 max-w-prose text-[13px] text-fg-2">
        Interest a state auditor could add if items go unreported. Computed only from the rules engine; unknown rules stay unknown.
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
      ) : (
        <div className="mb-5">
          <UnknownBadge label="Unknown" className="text-[28px] font-medium" />
        </div>
      )}
      {allUnknown ? (
        <p className="mb-4 text-[13px] text-fg-1">No state has a verified interest rule yet, so no amount is shown. Approve rule values in Rules to compute it.</p>
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
                  {s.status === "unknown" ? <UnknownBadge /> : <Money cents={s.interest!.cents} className="text-fg-1" />}
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
