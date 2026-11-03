/**
 * Pure helpers behind the activity "seismograph" strip and the timeline feed (DESIGN-V3 §4.5, §6.8). No React.
 *
 * The strip is two-sided: every recorded entry pushes its day's trace up (blue); approvals a person gave push the same
 * day's trace down (pink). Both sides share one scale, so a day where half the entries were approvals reads that way.
 */
import type { ActivityDensity, ActivityEntry, ActivityKind } from "@/lib/queries/activity";
import { barHeightPct } from "./strip-model";

export interface SeismoDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
  /** Approvals recorded by a person that day (a subset of `count`). */
  human: number;
  /** Entries that went wrong that day (failed run, rejected change). */
  attention: number;
  /** Upper trace height, percent of the half-strip. 0 for an empty day. */
  up: number;
  /** Lower trace height, percent of the half-strip. 0 when no person approved anything. */
  down: number;
  /** The loaded feed has a section for this day, so clicking scrolls instead of filtering. */
  inFeed: boolean;
}

/**
 * Merge the all-entries density with the approvals-only density for the same window. Human counts on days outside the
 * window are ignored, and a human count can never exceed the day's total (both come from the same stored rows, but the
 * strip must not draw a lower trace taller than the event count that contains it).
 */
export function seismoDays(all: Pick<ActivityDensity, "days">, human: Pick<ActivityDensity, "days"> | null, feedDays: ReadonlySet<string> = new Set()): SeismoDay[] {
  const humanByDay = new Map((human?.days ?? []).map((d) => [d.day, d.count]));
  const max = Math.max(1, ...all.days.map((d) => d.count));
  return all.days.map((d) => {
    const h = Math.min(d.count, humanByDay.get(d.day) ?? 0);
    return { day: d.day, count: d.count, human: h, attention: d.attention, up: barHeightPct(d.count, max), down: barHeightPct(h, max), inFeed: feedDays.has(d.day) };
  });
}

/** UTC day key of a timestamp. */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Stable DOM id of a feed day section; the strip scrolls to it. */
export const dayAnchorId = (day: string): string => `activity-day-${day}`;

export interface FeedDay<T> {
  key: string;
  day: Date;
  items: T[];
}

/** Group a newest-first feed into consecutive UTC-day sections, keeping order. */
export function groupByDay<T extends { at: Date }>(entries: readonly T[]): FeedDay<T>[] {
  const groups: FeedDay<T>[] = [];
  for (const e of entries) {
    const key = dayKey(e.at);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(e);
    else groups.push({ key, day: e.at, items: [e] });
  }
  return groups;
}

export type ActorKind = "agent" | "person" | "system";

/**
 * Who acted: an agent run is the agent (even when started from chat); an entry with a recorded actor name is a person;
 * anything else (ingestion, drafts, generated reports) was recorded by the system with no actor stored.
 */
export function actorKind(e: Pick<ActivityEntry, "kind" | "actor">): ActorKind {
  if (e.kind === "run") return "agent";
  return e.actor ? "person" : "system";
}

/** Kinds whose entries are approvals a person gave: the strip's lower trace and the pink actor dot. */
export const HUMAN_ACTION_KINDS: readonly ActivityKind[] = ["approval"];

/** The kinds to ask the approvals-only density for, given the active kind filter; empty when the filter excludes them. */
export function humanKindsFor(kinds: readonly ActivityKind[] | undefined): ActivityKind[] {
  return HUMAN_ACTION_KINDS.filter((k) => !kinds?.length || kinds.includes(k));
}

/** Toggle one kind in the active filter list (chips are multi-select), keeping ACTIVITY_KINDS order. */
export function toggleKind(active: readonly ActivityKind[] | undefined, kind: ActivityKind, order: readonly ActivityKind[]): ActivityKind[] {
  const set = new Set(active ?? []);
  if (set.has(kind)) set.delete(kind);
  else set.add(kind);
  return order.filter((k) => set.has(k));
}
