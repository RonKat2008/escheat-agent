import type { ActivityQuery } from "@/lib/queries/activity";

/** Query string (with leading "?", or "") for the filters; used by pagination links and the CSV export. */
export function activityQueryString(q: ActivityQuery): string {
  const p = new URLSearchParams();
  if (q.kinds?.length) p.set("kind", q.kinds.join(","));
  if (q.state) p.set("state", q.state);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.q) p.set("q", q.q);
  if (q.cursor) p.set("cursor", q.cursor);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const formatDay = (d: Date) => DAY.format(d);

/** "Nov 3, 2026": the year is always shown so a day never reads as ambiguous across years. */
const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
export const formatShortDay = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

export const formatTime = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;
