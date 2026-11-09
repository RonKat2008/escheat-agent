import { DEADLINE_LABEL, formatDate } from "@/lib/format";

/**
 * The dashboard hero's booking-style deadline rows (DESIGN-V4 §7): the next obligations, overdue first, each read left
 * to right as a span of time ("Today, Nov 1" → [14 days] → "Report due, Nov 15"; for an overdue one, "Report due,
 * Oct 2" → [30 days late] → "Today, Nov 1"). Every value comes from the overdue summary and upcomingDeadlines; nothing
 * is estimated.
 */
export interface HeroDeadlineInput {
  overdue: readonly {
    itemId: string;
    payeeName: string;
    state: string | null;
    cents: number;
    kind: string;
    date: string;
    daysLate: number;
    verified: boolean;
  }[];
  upcoming: readonly {
    itemId: string;
    payeeName: string;
    state: string | null;
    cents: number;
    kind: string;
    date: string;
    daysUntil: number;
    verified: boolean;
  }[];
  asOf: string;
}

export interface HeroDeadlineCard {
  key: string;
  href: string;
  title: string;
  state: string | null;
  cents: number;
  overdue: boolean;
  verified: boolean;
  from: { label: string; value: string };
  to: { label: string; value: string };
  /** The span between the two dates, e.g. "14 days" or "30 days late". */
  chip: string;
}

/** Short labels that fit over a booking numeral ("Window closes" rather than "Due diligence closes"). */
const SHORT_LABEL: Record<string, string> = { dd_window_end: "Window closes", report_due: "Report due", remit_due: "Remit due" };
const label = (kind: string): string => SHORT_LABEL[kind] ?? DEADLINE_LABEL[kind] ?? "Due";

const days = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

/** The first `limit` cards: overdue obligations (most late first, as given), then upcoming ones (soonest first). */
export function heroDeadlineCards(input: HeroDeadlineInput, limit = 2): HeroDeadlineCard[] {
  const today = { label: "Today", value: formatDate(input.asOf, { year: false }) };
  const late: HeroDeadlineCard[] = input.overdue.map((o) => ({
    key: `late-${o.itemId}-${o.kind}`,
    href: `/items?item=${o.itemId}`,
    title: o.payeeName,
    state: o.state,
    cents: o.cents,
    overdue: true,
    verified: o.verified,
    from: { label: label(o.kind), value: formatDate(o.date, { year: false }) },
    to: today,
    chip: `${days(o.daysLate)} late`,
  }));
  // A due-diligence window opening is not an obligation closing (DueChip): it never takes a hero slot.
  const soon: HeroDeadlineCard[] = input.upcoming
    .filter((e) => e.kind !== "dd_window_start")
    .map((e) => ({
      key: `next-${e.itemId}-${e.kind}`,
      href: `/items?item=${e.itemId}`,
      title: e.payeeName,
      state: e.state,
      cents: e.cents,
      overdue: false,
      verified: e.verified,
      from: today,
      to: { label: label(e.kind), value: formatDate(e.date, { year: false }) },
      chip: e.daysUntil <= 0 ? "Due today" : days(e.daysUntil),
    }));
  return [...late, ...soon].slice(0, limit);
}

/**
 * The panel's location line (R11-14): the demo date, then ONLY the states of the rows the panel shows (first-seen order,
 * capped), never the company's whole exposure footprint. With no rows there is no state to name.
 */
export function heroDeadlineWhere(asOf: string, cards: readonly Pick<HeroDeadlineCard, "state">[], maxStates = 4): string {
  const states = [...new Set(cards.flatMap((c) => (c.state ? [c.state] : [])))];
  const shown = states.slice(0, maxStates);
  const extra = states.length > maxStates ? ` +${states.length - maxStates}` : "";
  const date = `As of ${formatDate(asOf)}`;
  return shown.length > 0 ? `${date} · ${shown.join(", ")}${extra}` : date;
}
