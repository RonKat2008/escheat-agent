import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { AlertCircle, ArrowRight } from "lucide-react";
import {
  DateCell,
  EmptyState,
  KpiStat,
  Money,
  SectionCard,
  StatusPill,
  UnknownBadge,
  UnverifiedBadge,
  STALE_STATUS_ORDER,
  StatusDot,
} from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { outreach, reports } from "@/db/schema";
import { diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_LABEL, formatDate, formatSpan, PROPERTY_TYPE_LABEL, relativeDays } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import {
  explainItem,
  getAuditInterestExposure,
  getExposure,
  getFeaturedItem,
  getStatusCounts,
  listStaleItems,
  upcomingDeadlines,
} from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";

const TL_SHORT: Record<string, string> = {
  presumed_abandoned: "Abandoned",
  dd_window_start: "DD opens",
  dd_window_end: "DD closes",
  report_due: "Report due",
  remit_due: "Remit due",
};
const STATE_RAMP = ["bg-foreground", "bg-foreground/60", "bg-foreground/35", "bg-foreground/20", "bg-foreground/12"];

export async function NeedsReview() {
  const { db, companyId } = await getCtx();
  const res = await listStaleItems(db, companyId, { needsReview: true, limit: 1 });
  if (res.total === 0) return null;
  return (
    <Link
      href="/items?review=1"
      className="group flex items-center gap-3 rounded-xl border border-at-risk/40 bg-at-risk/8 px-4 py-3 text-sm transition-colors duration-150 hover:bg-at-risk/14"
    >
      <AlertCircle className="size-4 shrink-0 text-at-risk" aria-hidden />
      <span>
        <span className="font-medium">{res.total} {res.total === 1 ? "item needs" : "items need"} review.</span>{" "}
        <span className="text-muted-foreground">A classification is low-confidence or a rule is missing.</span>
      </span>
      <ArrowRight className="ml-auto size-4 shrink-0 text-at-risk transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export async function HeroExposure() {
  const { db, companyId } = await getCtx();
  const [exp, dl] = await Promise.all([getExposure(db, companyId), upcomingDeadlines(db, companyId, 400)]);
  const next = dl.events.find((e) => e.daysUntil >= 0);
  const states = [...exp.byState].sort((a, b) => b.cents - a.cents);
  return (
    <section
      aria-label="Total exposure"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-7"
      style={{ backgroundImage: "radial-gradient(600px 200px at 0% 0%, rgba(245,165,36,.07), transparent)" }}
    >
      <div className="grid gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:gap-10">
        <div className="flex min-w-0 flex-col justify-between gap-6">
          <KpiStat
            label="At risk today"
            value={exp.totalCents}
            currency
            tone="amber"
            size="hero"
            countUp
            hint={
              <span data-testid="exposure-meta">
                <span className="font-mono text-foreground">{exp.itemCount}</span> stale items · as of{" "}
                <time dateTime={exp.asOf} className="font-mono text-foreground">{formatDate(exp.asOf)}</time>
              </span>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/items" className={buttonVariants({ size: "sm" })}>
              Open items
            </Link>
            {exp.anyUnverified ? <UnverifiedBadge /> : null}
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">By owner state</h2>
            {next ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-at-risk/55 px-2.5 py-0.5 text-xs text-at-risk">
                Next deadline: {next.state ?? "?"} · {formatDate(next.date, { year: false })}
              </span>
            ) : null}
          </div>
          <div
            role="img"
            aria-label={`Exposure by state: ${states.map((s) => `${s.state} ${s.formatted}`).join(", ")}`}
            className="mb-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
          >
            {states.map((s, i) => (
              <div
                key={s.state}
                title={`${s.state}: ${s.formatted} (${s.count} items)`}
                className={cn("h-full first:rounded-l-full last:rounded-r-full", STATE_RAMP[Math.min(i, STATE_RAMP.length - 1)])}
                style={{ width: `${Math.max(2, (s.cents / Math.max(1, exp.totalCents)) * 100)}%` }}
              />
            ))}
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:gap-3">
            {states.map((s, i) => (
              <li key={s.state}>
                <Link
                  href={`/items?state=${s.state}`}
                  data-testid={`state-tile-${s.state}`}
                  className="block rounded-xl border border-border bg-background/40 p-2.5 transition-colors sm:p-3.5 duration-150 hover:border-strong hover:bg-raised"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-2 font-mono font-medium text-foreground">
                      <span aria-hidden className={cn("size-2 rounded-[3px]", STATE_RAMP[Math.min(i, STATE_RAMP.length - 1)])} />
                      {s.state}
                    </span>
                    <span><span className="font-mono">{s.count}</span><span className="hidden sm:inline"> items</span></span>
                  </div>
                  <div className="mt-2 font-mono text-[14px] leading-6 font-semibold tracking-tight tabular-nums sm:text-[22px] sm:leading-7 sm:tracking-normal">{s.formatted.replace(/\.00$/, "")}</div>
                  <div className="mt-2.5 h-0.5 rounded-full bg-border">
                    <div className="h-full rounded-full bg-at-risk" style={{ width: `${(s.cents / Math.max(1, exp.totalCents)) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Histogram({ counts, labels }: { counts: number[]; labels: string[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div role="img" aria-label={`Deadlines per week for the next 13 weeks: ${counts.join(", ")}`} className="mb-4">
      <div className="flex h-24 items-end gap-1.5">
        {counts.map((n, i) => (
          <div key={i} title={`${labels[i]}: ${n} deadline${n === 1 ? "" : "s"}`} className="flex h-full flex-1 items-end">
            <div
              className={cn("w-full rounded-t-[4px] origin-bottom", i < 2 ? "bg-at-risk" : "bg-slate/70", n === 0 && "opacity-30")}
              style={{ height: n === 0 ? 2 : `${Math.max(6, (n / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[counts.length - 1]}</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-at-risk" />Within 14 days</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-slate/70" />Later</span>
      </div>
    </div>
  );
}

export async function DeadlinesPanel() {
  const { db, companyId } = await getCtx();
  const { asOf, events } = await upcomingDeadlines(db, companyId, 90);
  if (events.length === 0) {
    return (
      <SectionCard title="Deadlines, next 90 days">
        <EmptyState title="No deadlines in the next 90 days" description="Move the demo clock forward to see upcoming report and due-diligence dates." />
      </SectionCard>
    );
  }
  const counts = Array.from({ length: 13 }, () => 0);
  for (const e of events) counts[Math.min(12, Math.floor(e.daysUntil / 7))]!++;
  const labels = counts.map((_, i) => formatDate(addDaysIso(asOf, i * 7), { year: false }));
  const shown = events.slice(0, 7);
  return (
    <SectionCard title="Deadlines, next 90 days" action={<span className="font-mono text-xs text-muted-foreground">{events.length} total</span>}>
      <Histogram counts={counts} labels={labels} />
      <ul className="divide-y divide-border border-t border-border">
        {shown.map((e) => (
          <li key={`${e.itemId}-${e.kind}`}>
            <Link
              href={`/items?item=${e.itemId}`}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5 text-sm transition-colors duration-150 hover:bg-raised/60 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_5.5rem]"
            >
              <span className="font-mono text-[13px]">{formatDate(e.date, { year: false })}</span>
              <span className="min-w-0">
                <span className={cn(e.daysUntil <= 14 ? "text-at-risk" : "text-muted-foreground")}>{DEADLINE_LABEL[e.kind]}</span>
                <span className="text-muted-foreground"> · {e.state ?? "?"} · </span>
                {e.payeeName}
                {e.checkNumber ? <span className="font-mono text-muted-foreground"> #{e.checkNumber}</span> : null}
              </span>
              <span className="flex items-center gap-2 justify-self-end">
                {!e.verified ? <UnverifiedBadge compact /> : null}
                <Money cents={e.amount.cents} className="text-[13px]" />
              </span>
              <span className="hidden justify-self-end text-xs text-muted-foreground sm:block">{relativeDays(e.daysUntil)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {events.length > shown.length ? (
        <p className="pt-3 text-xs text-muted-foreground">
          {events.length - shown.length} more.{" "}
          <Link href="/items?sort=deadline_asc" className="text-foreground underline-offset-2 hover:underline">
            See all in Items
          </Link>
        </p>
      ) : null}
    </SectionCard>
  );
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const BAR_TONE: Record<string, string> = { to_report: "bg-at-risk", dd_pending: "bg-at-risk/70", watching: "bg-slate/70" };

export async function StatusPanel() {
  const { db, companyId } = await getCtx();
  const [counts, review, drafts, ready] = await Promise.all([
    getStatusCounts(db, companyId),
    listStaleItems(db, companyId, { needsReview: true, limit: 1 }),
    db.select({ n: count() }).from(outreach).where(and(eq(outreach.companyId, companyId), inArray(outreach.status, ["draft", "awaiting_approval"]))),
    db.select({ n: count() }).from(reports).where(and(eq(reports.companyId, companyId), inArray(reports.status, ["validated", "awaiting_approval", "approved"]))),
  ]);
  const byStatus = new Map(counts.map((c) => [c.status as string, c]));
  const total = counts.reduce((a, c) => a + c.count, 0);
  const rows = STALE_STATUS_ORDER.map((s) => ({ status: s, c: byStatus.get(s) })).filter((r) => r.c && r.c.count > 0);
  const actions = [
    { href: "/items?review=1", n: review.total, one: "item needs review", many: "items need review" },
    { href: "/approvals", n: drafts[0]?.n ?? 0, one: "draft awaiting approval", many: "drafts awaiting approval" },
    { href: "/reports", n: ready[0]?.n ?? 0, one: "report ready to file", many: "reports ready to file" },
  ].filter((a) => a.n > 0);
  return (
    <SectionCard
      title="Status"
      action={<span className="font-mono text-xs text-muted-foreground">{total} items</span>}
      className="flex h-full flex-col"
      bodyClassName="flex flex-1 flex-col"
    >
      {rows.length === 0 ? (
        <EmptyState title="No items yet" description="Seed the demo data or upload a check register in Settings." />
      ) : (
        <>
          <div role="img" aria-label={`Items by status: ${rows.map((r) => `${r.c!.count} ${r.status.replace(/_/g, " ")}`).join(", ")}`} className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {rows.map(({ status, c }) => (
              <div key={status} className={cn("h-full", BAR_TONE[status] ?? "bg-foreground/30")} style={{ width: `${Math.max(2, (c!.count / Math.max(1, total)) * 100)}%` }} />
            ))}
          </div>
          <ul className="-mx-2">
            {rows.map(({ status, c }) => (
              <li key={status}>
                <Link href={`/items?status=${status}`} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors duration-150 hover:bg-raised">
                  <StatusDot status={status} withLabel className="flex-1" />
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{formatUSD(c!.cents)}</span>
                  <span className="w-8 text-right font-mono">{c!.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          {actions.length > 0 ? (
            <div className="mt-auto border-t border-border pt-3">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Next actions</h3>
              <ul className="-mx-2">
                {actions.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors duration-150 hover:bg-raised">
                      <span className="w-8 font-mono text-at-risk">{a.n}</span>
                      <span className="flex-1">{a.n === 1 ? a.one : a.many}</span>
                      <ArrowRight className="size-3.5 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

export async function FeaturedItem() {
  const { db, companyId } = await getCtx();
  const item = await getFeaturedItem(db, companyId);
  if (!item) {
    return (
      <SectionCard title="Featured item">
        <EmptyState title="Check #10482 is not in this dataset" description="Run pnpm seed:demo to load the featured Bayline Electric check." />
      </SectionCard>
    );
  }
  const ex = await explainItem(db, item.id);
  const nd = item.nextDeadline;
  const days = nd ? diffDays(ex?.asOf as IsoDate, nd.date as IsoDate) : null;
  const timeline = ex?.timeline ?? [];
  const nextKey = timeline.find((t) => t.date && t.date >= (ex?.asOf ?? ""))?.key;
  return (
    <section
      aria-label="Featured item"
      className="rounded-2xl border border-strong bg-surface p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Featured · check <span className="font-mono">#{item.checkNumber}</span></h2>
        <StatusPill status={item.status} />
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0 truncate text-lg font-medium">{item.payeeName}</div>
        <Money cents={item.amount.cents} className="text-2xl font-semibold" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Issued</dt>
          <dd><span className="font-mono">{formatSpan(item.ageDays)}</span> ago · {PROPERTY_TYPE_LABEL[item.propertyType]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Owner state</dt>
          <dd>
            <span className="font-mono">{item.ownerState ?? "Unknown"}</span>
            <span className="text-muted-foreground"> · by {item.ownerStateBasis === "incorporation" ? "state of incorporation" : item.ownerStateBasis === "address" ? "last known address" : "unknown basis"}</span>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Next legal date</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {nd ? (
              <>
                <DateCell date={nd.date} />
                <span className="text-muted-foreground">{DEADLINE_LABEL[nd.kind]}</span>
                {days !== null ? <span className="font-mono text-at-risk">{relativeDays(days)}</span> : null}
                {!nd.verified ? <UnverifiedBadge /> : null}
              </>
            ) : (
              <UnknownBadge />
            )}
          </dd>
        </div>
      </dl>
      {timeline.length > 0 ? (
        <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Timeline">
          {timeline.map((t) => (
            <li key={t.key} className="min-w-0">
              <div className="mb-1.5 flex items-center">
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full border",
                    t.key === nextKey ? "border-at-risk bg-at-risk/30 ring-4 ring-at-risk/15" : t.date && ex && t.date < ex.asOf ? "border-slate bg-slate" : "border-subtle bg-transparent",
                  )}
                />
                <span aria-hidden className="ml-1 h-px flex-1 bg-border" />
              </div>
              <div className="truncate font-mono text-[11px]">{t.date ? formatDate(t.date, { year: false }) : "Unknown"}</div>
              <div className="truncate text-[11px] text-muted-foreground" title={t.label}>{TL_SHORT[t.key] ?? t.label}</div>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-5">
        <Link href={`/items?item=${item.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          View timeline
          <ArrowRight className="size-3.5" aria-hidden />
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
    <SectionCard
      title="Audit-interest exposure"
      action={ai.anyUnverified ? <UnverifiedBadge /> : null}
    >
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        Interest a state auditor could add if items go unreported. Computed only from the rules engine; unknown rules stay unknown.
      </p>
      {ai.total ? (
        <div className="mb-4">
          <div className="flex items-baseline gap-3">
            <Money cents={ai.total.cents} className="text-3xl font-semibold text-at-risk" />
            <span className="text-sm text-muted-foreground">on {exp.total.formatted} principal</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-border" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Interest as a share of principal">
            <div className="h-full rounded-full bg-at-risk" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="font-mono text-3xl font-semibold text-muted-foreground">Unknown</span>
          <UnknownBadge />
        </div>
      )}
      {allUnknown ? (
        <p className="mb-3 text-sm">No state has a verified interest rule yet, so no amount is shown. Approve rule values in Rules to compute it.</p>
      ) : null}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {ai.byState.map((s) => (
          <li key={s.state} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
            <span className="w-8 font-mono font-medium">{s.state}</span>
            <span className="text-muted-foreground">{s.itemCount} items · {s.principal.formatted}</span>
            <span className="ml-auto flex items-center gap-2">
              {s.status === "unknown" ? <UnknownBadge /> : <Money cents={s.interest!.cents} />}
              {s.status === "ok" && !s.verified ? <UnverifiedBadge /> : null}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
