import Link from "next/link";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABEL, type ActivityQuery } from "@/lib/queries/activity";
import { toggleKind } from "./density-model";
import { activityQueryString } from "./format";
import { cn } from "@/lib/utils";

const STATES = ["CA", "DE", "TX"] as const;
const FIELD =
  "h-9 w-full min-w-0 rounded-md border border-line-hover bg-ink-2 px-2.5 text-[13px] text-fg-1 outline-none hover:border-line-strong focus-visible:border-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";
const LABEL = "mb-1 block text-xs text-fg-3";

/** Plain GET form: filters live in the URL, no client JS required. */
export function ActivityFilters({ query, exportHref }: { query: ActivityQuery; exportHref: string }) {
  return (
    <form method="get" action="/activity" role="search" aria-label="Filter activity" className="mb-6 grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]">
      {query.kinds?.length ? <input type="hidden" name="kind" value={query.kinds.join(",")} /> : null}
      <div className="col-span-2 sm:col-span-3 lg:col-span-1">
        <label htmlFor="activity-q" className={LABEL}>
          Search
        </label>
        <input id="activity-q" name="q" type="search" defaultValue={query.q ?? ""} placeholder="Actor, title, hash" maxLength={100} className={cn(FIELD, "placeholder:text-fg-3")} />
      </div>
      <div>
        <label htmlFor="activity-state" className={LABEL}>
          State
        </label>
        <select id="activity-state" name="state" defaultValue={query.state ?? ""} className={FIELD}>
          <option value="">All states</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="activity-from" className={LABEL}>
          From
        </label>
        <input id="activity-from" name="from" type="date" defaultValue={query.from ?? ""} className={FIELD} />
      </div>
      <div>
        <label htmlFor="activity-to" className={LABEL}>
          To
        </label>
        <input id="activity-to" name="to" type="date" defaultValue={query.to ?? ""} className={FIELD} />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-3 lg:col-span-1">
        <button type="submit" className={cn(buttonVariants(), "h-9")}>
          Apply
        </button>
        <Link href="/activity" className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
          Clear
        </Link>
        <a href={exportHref} download className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")} data-testid="activity-export">
          <Download className="size-3.5" strokeWidth={1.5} aria-hidden />
          Export CSV
        </a>
      </div>
    </form>
  );
}

const CHIP =
  "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";

/**
 * Kind filter chips from ACTIVITY_KINDS (§6.8). Multi-select: each chip toggles its kind in the URL, "All kinds" clears
 * them. Plain links, so the filter works without JS and is shareable. Other filters and the page reset with each toggle.
 */
export function ActivityKindChips({ query }: { query: ActivityQuery }) {
  const href = (kinds: ActivityQuery["kinds"]) => `/activity${activityQueryString({ ...query, kinds, cursor: undefined })}`;
  const none = !query.kinds?.length;
  return (
    <nav aria-label="Kind" data-testid="activity-kind-chips" className="es-scroll-x -mx-4 mb-6 flex gap-1.5 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      <Link href={href(undefined)} aria-current={none ? "true" : undefined} className={cn(CHIP, none ? "border-blue-700 bg-blue-900 text-blue-300" : "border-line text-fg-2 hover:border-line-hover hover:bg-ink-2 hover:text-fg-1")}>
        All kinds
      </Link>
      {ACTIVITY_KINDS.map((k) => {
        const on = Boolean(query.kinds?.includes(k));
        const next = toggleKind(query.kinds, k, ACTIVITY_KINDS);
        return (
          <Link
            key={k}
            href={href(next.length ? next : undefined)}
            aria-current={on ? "true" : undefined}
            data-testid="activity-kind-chip"
            data-kind={k}
            className={cn(CHIP, on ? "border-blue-700 bg-blue-900 text-blue-300" : "border-line text-fg-2 hover:border-line-hover hover:bg-ink-2 hover:text-fg-1")}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", on ? "bg-blue-400" : "bg-fg-4")} />
            {ACTIVITY_KIND_LABEL[k]}
            {on ? <span className="sr-only"> (selected, select to remove)</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
