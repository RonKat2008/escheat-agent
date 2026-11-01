import Link from "next/link";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABEL, type ActivityQuery } from "@/lib/queries/activity";
import { cn } from "@/lib/utils";

const STATES = ["CA", "DE", "TX"] as const;
const FIELD =
  "h-9 w-full min-w-0 rounded-md border border-line-hover bg-ink-2 px-2.5 text-[13px] text-fg-1 outline-none hover:border-line-strong focus-visible:border-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";
const LABEL = "mb-1 block text-xs text-fg-3";

/** Plain GET form: filters live in the URL, no client JS required. */
export function ActivityFilters({ query, exportHref }: { query: ActivityQuery; exportHref: string }) {
  const kind = query.kinds?.length === 1 ? query.kinds[0] : "";
  return (
    <form method="get" action="/activity" role="search" aria-label="Filter activity" className="mb-6 grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
      <div className="col-span-2 sm:col-span-3 lg:col-span-1">
        <label htmlFor="activity-q" className={LABEL}>
          Search
        </label>
        <input id="activity-q" name="q" type="search" defaultValue={query.q ?? ""} placeholder="Actor, title, hash" maxLength={100} className={cn(FIELD, "placeholder:text-fg-3")} />
      </div>
      <div>
        <label htmlFor="activity-kind" className={LABEL}>
          Kind
        </label>
        <select id="activity-kind" name="kind" defaultValue={kind} className={FIELD}>
          <option value="">All kinds</option>
          {ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACTIVITY_KIND_LABEL[k]}
            </option>
          ))}
        </select>
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
