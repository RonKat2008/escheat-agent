import Link from "next/link";
import { InView } from "@/components/motion";
import type { ActivityDensity, ActivityQuery } from "@/lib/queries/activity";
import { cn } from "@/lib/utils";
import { activityQueryString } from "./format";
import { barHeightPct, inRange, stripCaption } from "./strip-model";

const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const shortDay = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/**
 * Entries per UTC day over the last 30 days of the filtered record. One column per day: a blue bar for the day's
 * entries (its pink base is the part that needs attention), a faint tick for an empty day. Days with entries link
 * to that day alone; days outside a chosen From/To range are shaded, not removed, so the context stays.
 */
export function DayStrip({ density, query }: { density: ActivityDensity; query: ActivityQuery }) {
  const max = Math.max(1, ...density.days.map((d) => d.count));
  const caption = stripCaption(density, shortDay);
  return (
    <section aria-labelledby="activity-strip-h" data-testid="activity-strip" className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3">
        <h2 id="activity-strip-h" className="text-[13px] text-fg-2">
          <span className="num text-base font-medium tracking-[-0.01em] text-fg-1">{density.total}</span>{" "}
          {density.total === 1 ? "entry" : "entries"} from {shortDay(density.from)} to {shortDay(density.to)}
        </h2>
        <p className="text-xs text-fg-3">{caption}</p>
      </div>
      <InView className="relative flex h-14 items-end gap-[3px] border-b border-line px-3" threshold={0.5}>
        {density.days.map((d, i) => {
          const shaded = !inRange(d.day, query.from, query.to);
          const label = `${shortDay(d.day)}: ${d.count} ${d.count === 1 ? "entry" : "entries"}${d.attention ? `, ${d.attention} needing attention` : ""}`;
          if (d.count === 0) {
            return (
              <span key={d.day} title={label} className={cn("flex h-full flex-1 items-end", shaded && "opacity-35")}>
                <span aria-hidden className="h-[3px] w-full rounded-[1px] bg-line-hover" />
              </span>
            );
          }
          const href = `/activity${activityQueryString({ ...query, from: d.day, to: d.day, cursor: undefined })}`;
          const attentionPct = (d.attention / d.count) * 100;
          return (
            <Link
              key={d.day}
              href={href}
              title={label}
              aria-label={`Show ${label}`}
              data-testid="activity-strip-day"
              className={cn(
                "group/day relative flex h-full flex-1 items-end rounded-[2px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400",
                shaded && "opacity-35",
              )}
            >
              <span aria-hidden className="absolute inset-x-[-1.5px] inset-y-0 rounded-[3px] bg-white/0 transition-colors duration-150 group-hover/day:bg-white/[0.05]" />
              <span
                aria-hidden
                className="es-iv-grow-y relative flex w-full origin-bottom flex-col justify-end overflow-hidden rounded-t-[2px] bg-blue-500 transition-colors duration-150 group-hover/day:bg-blue-400"
                style={{ height: `${barHeightPct(d.count, max)}%`, ["--i" as string]: i }}
              >
                {d.attention > 0 ? <span className="w-full bg-pink-500" style={{ height: `${attentionPct}%` }} /> : null}
              </span>
            </Link>
          );
        })}
      </InView>
      <div aria-hidden className="mt-1.5 flex justify-between px-3 text-[11px] text-fg-3">
        <span>{shortDay(density.from)}</span>
        <span className="max-sm:hidden">{shortDay(density.days[Math.floor(density.days.length / 2)]!.day)}</span>
        <span>{shortDay(density.to)}</span>
      </div>
    </section>
  );
}
