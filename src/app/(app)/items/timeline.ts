import type { Explanation, TimelineEvent } from "@/lib/queries";

export interface TimelineSource {
  url: string;
  title: string;
  quote: string;
}

export interface TimelineNode {
  key: string;
  label: string;
  /** One plain-English line, always visible: what this date means for the holder. */
  meaning: string;
  date: string | null;
  status: "ok" | "unknown" | "not_applicable";
  verified: boolean;
  ruleVersion: string | null;
  rulePaths: string[];
  sources: TimelineSource[];
  notes: string[];
  /** Plain-English derivation from the rules engine (legal dates only). */
  derivation: string[];
  /** Business-day roll provenance, when the roll changed the date. */
  roll: string | null;
  legal: boolean;
}

export type NodeState = "past" | "next" | "future" | "unknown";

/** What each legal date means, in one line. Facts about the date come from the engine; this is only the gloss. */
const MEANING: Record<TimelineEvent["key"], (state: string) => string> = {
  presumed_abandoned: () => "Dormancy period under the owner state's law ends",
  dd_window_start: () => "You may start sending the due-diligence letter",
  dd_window_end: () => "Last day to send the due-diligence letter",
  report_due: (s) => `File the holder report with ${s}`,
  remit_due: (s) => `Send the funds to ${s}`,
};

export function buildNodes(ex: Explanation): TimelineNode[] {
  const byKey = new Map<string, TimelineEvent>(ex.timeline.map((e) => [e.key, e]));
  const state = ex.item.ownerState ?? "the state";
  const fromEv = (key: TimelineEvent["key"], label: string): TimelineNode => {
    const e = byKey.get(key);
    return {
      key,
      label,
      meaning: MEANING[key](state),
      date: e?.date ?? null,
      status: e?.status ?? "unknown",
      verified: e?.verified ?? false,
      ruleVersion: e?.ruleVersion ?? null,
      rulePaths: e?.rulePaths ?? [],
      sources: e?.sources ?? [],
      notes: e?.notes ?? [],
      derivation: e?.derivation ?? [],
      roll: e?.roll ?? null,
      legal: true,
    };
  };
  const plain = (key: string, label: string, date: string | null, meaning: string): TimelineNode => ({
    key,
    label,
    meaning,
    date,
    status: date ? "ok" : "unknown",
    verified: true,
    ruleVersion: null,
    rulePaths: [],
    sources: [],
    notes: [],
    derivation: [],
    roll: null,
    legal: false,
  });
  const stage = ex.item.reportStage ? ` (${ex.item.reportStage})` : "";
  const activity = ex.ledger.lastActivityDate && ex.ledger.lastActivityDate !== ex.ledger.issueDate;
  return [
    plain("issued", activity ? "Last activity" : "Issued", ex.ledger.lastActivityDate ?? ex.ledger.issueDate, "From the ledger"),
    plain("stale", "Stale", ex.item.staleSince, "Business threshold, not law"),
    fromEv("presumed_abandoned", "Presumed abandoned"),
    fromEv("dd_window_start", "Due-diligence window opens"),
    fromEv("dd_window_end", "Due-diligence window closes"),
    fromEv("report_due", `Report due${stage}`),
    fromEv("remit_due", "Remit due"),
  ];
}

export interface NumberedSources {
  /** Every distinct source in first-cited order, numbered from 1. */
  list: (TimelineSource & { n: number })[];
  /** Node key -> the reference numbers it cites, ascending, no repeats. */
  refs: Map<string, number[]>;
}

/**
 * De-duplicates sources across the whole timeline (one entry per URL, the first quote wins) and numbers them in the
 * order they are first cited, so each date can point at "[1] [3]" instead of repeating the same statute link.
 */
export function numberSources(nodes: readonly Pick<TimelineNode, "key" | "sources">[]): NumberedSources {
  const byUrl = new Map<string, number>();
  const list: NumberedSources["list"] = [];
  const refs = new Map<string, number[]>();
  for (const node of nodes) {
    const mine = new Set<number>();
    for (const s of node.sources) {
      const url = s.url.trim();
      if (!url) continue;
      let n = byUrl.get(url);
      if (n === undefined) {
        n = list.length + 1;
        byUrl.set(url, n);
        list.push({ n, url, title: s.title, quote: s.quote });
      }
      mine.add(n);
    }
    if (mine.size > 0) refs.set(node.key, [...mine].sort((a, b) => a - b));
  }
  return { list, refs };
}

/**
 * Where the "today" marker goes: before the first dated node on or after `asOf`. Undated nodes never decide the
 * position. Returns nodes.length when every dated node is in the past, and null when nothing is dated.
 */
export function todayIndex(nodes: readonly Pick<TimelineNode, "date">[], asOf: string): number | null {
  if (!nodes.some((n) => n.date)) return null;
  const i = nodes.findIndex((n) => n.date !== null && n.date >= asOf);
  return i === -1 ? nodes.length : i;
}

export function nodeState(n: Pick<TimelineNode, "key" | "date">, nextKey: string | undefined, asOf: string): NodeState {
  if (!n.date) return "unknown";
  if (n.key === nextKey) return "next";
  return n.date < asOf ? "past" : "future";
}
