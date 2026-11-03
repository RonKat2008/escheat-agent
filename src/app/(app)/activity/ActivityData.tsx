import Link from "next/link";
import { CopyValue } from "@/components/motion";
import { isFirstVisit } from "@/components/motion/first-visit";
import { EmptyState } from "@/components/primitives";
import { ACTIVITY_KIND_LABEL, activityDensity, DEFAULT_ACTIVITY_LIMIT, listActivity, parseActivityParams, type ActivityEntry } from "@/lib/queries/activity";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";
import { ActivityFilters, ActivityKindChips } from "./ActivityFilters";
import { actorKind, dayAnchorId, groupByDay, humanKindsFor, seismoDays, type ActorKind } from "./density-model";
import { DensityStrip } from "./DensityStrip";
import { activityQueryString, formatDay, formatTime } from "./format";
import { inRange, stripCaption } from "./strip-model";

const LINK =
  "font-medium text-fg-1 outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-blue-400";

const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const shortDay = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/**
 * Actor glyph on the timeline rail (§6.8): an agent run is a blue thread (the brand's diagonal), a person's approval is
 * a pink dot, another person's action a hollow dot, and a system record a small neutral dot. The text label next to the
 * entry carries the same meaning, so color is never the only signal.
 */
function ActorGlyph({ actor, approval }: { actor: ActorKind; approval: boolean }) {
  if (actor === "agent") {
    return (
      <span aria-hidden className="grid size-4 place-items-center rounded-[4px] border border-blue-700 bg-ink-1">
        <svg viewBox="0 0 16 16" className="size-3">
          <line x1="3" y1="13" x2="13" y2="3" stroke="var(--color-blue-400)" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (actor === "person") {
    return approval ? (
      <span aria-hidden className="grid size-4 place-items-center rounded-full bg-ink-0">
        <span className="size-2.5 rounded-full bg-pink-500 ring-2 ring-pink-900" />
      </span>
    ) : (
      <span aria-hidden className="grid size-4 place-items-center rounded-full bg-ink-0">
        <span className="size-2.5 rounded-full border-[1.5px] border-fg-2" />
      </span>
    );
  }
  return (
    <span aria-hidden className="grid size-4 place-items-center rounded-full bg-ink-0">
      <span className="size-1.5 rounded-full bg-fg-4" />
    </span>
  );
}

function actorText(e: ActivityEntry, actor: ActorKind) {
  if (actor === "agent") return <>Agent{e.actor ? <span className="text-fg-3"> · {e.actor}</span> : null}</>;
  if (actor === "person") return <>By <span className="text-fg-1">{e.actor}</span></>;
  return <>System record</>;
}

function Entry({ e, i }: { e: ActivityEntry; i: number }) {
  const actor = actorKind(e);
  const approval = e.kind === "approval";
  return (
    <li
      style={{ ["--i" as string]: i }}
      className="es-stagger group relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 py-3 pr-3 pl-1 transition-colors duration-100 hover:bg-ink-2 sm:grid-cols-[16px_80px_minmax(0,1fr)_minmax(0,190px)] sm:items-baseline sm:gap-x-4"
      data-testid="activity-entry"
      data-kind={e.kind}
      data-actor={actor}
    >
      <span className="row-span-3 self-start pt-0.5 sm:row-span-1">
        <ActorGlyph actor={actor} approval={approval} />
      </span>
      <time dateTime={e.at.toISOString()} className="num text-[13px] whitespace-nowrap text-fg-2" title={`Recorded ${e.at.toISOString()} (real clock)`}>
        {formatTime(e.at)}
      </time>
      <div className="min-w-0 sm:col-start-3">
        <p className="mb-0.5 inline-flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
          <span className="instrument-label">{ACTIVITY_KIND_LABEL[e.kind]}</span>
          {e.attention ? <span className="font-medium text-pink-400">needs attention</span> : null}
        </p>
        <p>
          <Link href={e.href} className={LINK}>
            {e.title}
          </Link>
        </p>
        {e.detail ? <p className="mt-0.5 truncate text-xs text-fg-3">{e.detail}</p> : null}
        {e.payloadHash ? (
          <p className="relative z-10 mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
            Payload sha256 <CopyValue value={e.payloadHash} label="payload hash prefix" />
          </p>
        ) : null}
      </div>
      <p className={cn("col-start-2 truncate text-xs sm:col-start-4 sm:text-right", actor === "person" && approval ? "text-pink-300" : "text-fg-2")}>
        {actorText(e, actor)}
        {e.state ? <span className="num text-fg-3"> · {e.state}</span> : null}
      </p>
    </li>
  );
}

export async function ActivityData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseActivityParams(await searchParams);
  const { db, companyId } = await getCtx();
  const [page, density, first] = await Promise.all([
    listActivity(db, companyId, { ...query, limit: DEFAULT_ACTIVITY_LIMIT }),
    activityDensity(db, companyId, query),
    isFirstVisit("activity"),
  ]);
  const humanKinds = humanKindsFor(query.kinds);
  // Same window as the main strip (pinned with `to`), approvals only: the strip's lower, human trace.
  const human = humanKinds.length ? await activityDensity(db, companyId, { ...query, kinds: humanKinds, to: density.to }) : null;
  const filtered = Boolean(query.kinds || query.state || query.from || query.to || query.q);

  const groups = groupByDay(page.entries);
  const days = seismoDays(density, human, new Set(groups.map((g) => g.key)));
  const hrefs = Object.fromEntries(days.map((d) => [d.day, `/activity${activityQueryString({ ...query, from: d.day, to: d.day, cursor: undefined })}`]));
  const index = new Map(page.entries.map((e, i) => [e.id, i]));

  return (
    <div>
      {density.total > 0 || !filtered ? (
        <DensityStrip
          days={days}
          hrefs={hrefs}
          from={density.from}
          to={density.to}
          total={density.total}
          caption={stripCaption(density, shortDay)}
          shaded={days.filter((d) => !inRange(d.day, query.from, query.to)).map((d) => d.day)}
        />
      ) : null}
      <ActivityKindChips query={query} />
      <ActivityFilters query={query} exportHref={`/api/activity.csv${activityQueryString({ ...query, cursor: undefined })}`} />
      {page.entries.length === 0 ? (
        <EmptyState
          title={filtered ? "No activity matches these filters" : "No activity recorded yet"}
          description={
            filtered
              ? "Nothing in the stored records matches. Widen the date range or clear a filter."
              : "Entries appear here as items are ingested, approvals are given, letters go out, reports are generated and agents run."
          }
          action={
            filtered ? (
              <Link href="/activity" className="text-[13px] text-blue-400 underline underline-offset-2 hover:text-blue-300">
                Clear filters
              </Link>
            ) : null
          }
        />
      ) : (
        <div data-testid="activity-log" data-first-visit={first && !query.cursor ? "true" : "false"}>
          <p className="mb-3 text-xs text-fg-3" data-testid="activity-clock-note">
            Times are when each row was recorded, on the real clock in UTC. The demo clock in the top bar moves rule dates, not this record.
          </p>
          {groups.map((g) => (
            <section key={g.key} id={dayAnchorId(g.key)} tabIndex={-1} aria-labelledby={`${dayAnchorId(g.key)}-h`} data-testid="activity-day" className="mb-6 scroll-mt-28 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
              <h2 id={`${dayAnchorId(g.key)}-h`} className="sticky top-12 z-10 mb-1 flex items-baseline justify-between gap-3 bg-ink-0/85 px-1 py-1.5 backdrop-blur-sm">
                <span className="text-[13px] font-medium text-fg-1">{formatDay(g.day)}</span>
                <span className="num text-xs font-normal text-fg-3">
                  {g.items.length} {g.items.length === 1 ? "entry" : "entries"}
                </span>
              </h2>
              <ol className="relative border-t border-line before:absolute before:top-0 before:bottom-0 before:left-[12px] before:w-px before:bg-line-hover">
                {g.items.map((e) => (
                  <Entry key={e.id} e={e} i={index.get(e.id) ?? 0} />
                ))}
              </ol>
            </section>
          ))}
          <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[13px] text-fg-3">
            <span>
              Showing <span className="num text-fg-1">{page.entries.length}</span> entries, times in UTC (real clock).
            </span>
            {query.cursor ? (
              <Link href={`/activity${activityQueryString({ ...query, cursor: undefined })}`} className="text-blue-400 underline underline-offset-2 hover:text-blue-300">
                Back to newest
              </Link>
            ) : null}
            {page.nextCursor ? (
              <Link
                href={`/activity${activityQueryString({ ...query, cursor: page.nextCursor })}`}
                rel="next"
                className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
              >
                Older entries
              </Link>
            ) : (
              <span>End of the record.</span>
            )}
          </nav>
        </div>
      )}
      <p className="mt-6 max-w-2xl px-1 text-xs text-fg-3">
        The database keeps each item&apos;s current status and the timestamps below, not a status history, so a report or recovery
        shows when it was created or submitted with its status now.
      </p>
    </div>
  );
}
