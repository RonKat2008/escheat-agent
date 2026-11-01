import Link from "next/link";
import { CopyValue } from "@/components/motion";
import { isFirstVisit } from "@/components/motion/first-visit";
import { EmptyState } from "@/components/primitives";
import { ACTIVITY_KIND_LABEL, activityDensity, DEFAULT_ACTIVITY_LIMIT, listActivity, parseActivityParams, type ActivityEntry } from "@/lib/queries/activity";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";
import { ActivityFilters } from "./ActivityFilters";
import { DayStrip } from "./DayStrip";
import { activityQueryString, dayKey, formatDay, formatTime } from "./format";

const LINK =
  "font-medium text-fg-1 outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-blue-400";

function Entry({ e, i }: { e: ActivityEntry; i: number }) {
  return (
    <li style={{ ["--i" as string]: i }} className="es-stagger group relative grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 border-b border-line px-3 py-3 transition-colors duration-100 hover:bg-ink-2 sm:grid-cols-[84px_112px_minmax(0,1fr)_minmax(0,200px)] sm:items-baseline" data-testid="activity-entry" data-kind={e.kind}>
      <time dateTime={e.at.toISOString()} className="num text-[13px] whitespace-nowrap text-fg-2" title={e.at.toISOString()}>
        {formatTime(e.at)}
      </time>
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-2 sm:order-none">
        <span aria-hidden className={cn("size-1.5 rounded-full", e.attention ? "bg-pink-500" : "bg-fg-4")} />
        {ACTIVITY_KIND_LABEL[e.kind]}
        {e.attention ? <span className="font-medium text-pink-400">needs attention</span> : null}
      </span>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <Link href={e.href} className={LINK}>
          {e.title}
        </Link>
        {e.detail ? <p className="mt-0.5 truncate text-xs text-fg-3">{e.detail}</p> : null}
        {e.payloadHash ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
            Payload sha256 <CopyValue value={e.payloadHash} label="payload hash prefix" />
          </p>
        ) : null}
      </div>
      <p className="col-span-2 truncate text-xs text-fg-3 sm:col-span-1 sm:text-right">
        {e.actor ? <>By <span className="text-fg-2">{e.actor}</span></> : null}
        {e.actor && e.state ? " · " : null}
        {e.state ? <span className="num">{e.state}</span> : null}
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
  const filtered = Boolean(query.kinds || query.state || query.from || query.to || query.q);

  const groups: { key: string; day: Date; items: ActivityEntry[] }[] = [];
  for (const e of page.entries) {
    const key = dayKey(e.at);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(e);
    else groups.push({ key, day: e.at, items: [e] });
  }

  const index = new Map(page.entries.map((e, i) => [e.id, i]));

  return (
    <div>
      <ActivityFilters query={query} exportHref={`/api/activity.csv${activityQueryString({ ...query, cursor: undefined })}`} />
      {density.total > 0 || !filtered ? <DayStrip density={density} query={query} /> : null}
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
          {groups.map((g) => (
            <section key={g.key} aria-label={formatDay(g.day)} className="mb-6">
              <h2 className="sticky top-12 z-10 mb-1 bg-black/85 px-3 py-1.5 text-xs font-medium text-fg-2 backdrop-blur-sm">{formatDay(g.day)}</h2>
              <ul className="border-t border-line">
                {g.items.map((e) => (
                  <Entry key={e.id} e={e} i={index.get(e.id) ?? 0} />
                ))}
              </ul>
            </section>
          ))}
          <nav aria-label="Pagination" className="flex items-center gap-4 px-3 text-[13px] text-fg-3">
            <span>
              Showing <span className="num text-fg-1">{page.entries.length}</span> entries, times in UTC.
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
      <p className="mt-6 max-w-2xl px-3 text-xs text-fg-3">
        The database keeps each item&apos;s current status and the timestamps below, not a status history, so a report or recovery
        shows when it was created or submitted with its status now.
      </p>
    </div>
  );
}
