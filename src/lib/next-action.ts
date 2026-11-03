/**
 * Next best action (DESIGN-V3 §5.2): a pure, deterministic priority over the Loop Bar counts and the deadlines.
 * Order: (1) approvals with a deadline within 7 days, (2) any approvals, (3) items due for due diligence without a
 * draft, (4) approved reports to file, (5) unverified rules that block dates, (6) all clear with the next deadline.
 * No I/O; the shell feeds it the numbers from src/components/shell/loop-data.ts. Every count it shows comes from there.
 */
import { diffDays, type IsoDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/** Counts of the four loop stages. null = unknown (no ledger connected yet); never a substituted number. */
export interface LoopCounts {
  triage: number | null;
  draft: number | null;
  approve: number | null;
  file: number | null;
}

export interface NextActionInput {
  counts: LoopCounts;
  /** Simulated "today". */
  asOf: IsoDate;
  /** Approvals whose item has a deadline within 7 days of asOf. */
  urgentApprovals: number;
  /** Earliest deadline among the items behind waiting approvals (asOf or later), if any. */
  urgentDeadline: IsoDate | null;
  /** Open items whose dates depend on an unverified rule value. */
  unverifiedBlocking: number;
  /** Next deadline on any open item (asOf or later), for the all-clear line. */
  nextDeadline: IsoDate | null;
}

export type NextActionKind = "approve_urgent" | "approve" | "draft" | "file" | "verify_rules" | "all_clear" | "setup";

export interface NextAction {
  kind: NextActionKind;
  /** Short verb phrase for the pill and the palette ("Approve 2 items"). */
  label: string;
  /** Second clause ("due tomorrow"), or null. */
  detail: string | null;
  href: string;
  /** The count the label is about (null when the action has none). */
  count: number | null;
  /** Needs a person now: rendered pink. */
  human: boolean;
}

export const URGENT_DAYS = 7;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "due today" / "due tomorrow" / "due in 5 days" / "overdue by 2 days". */
export function duePhrase(asOf: IsoDate, date: IsoDate): string {
  const d = diffDays(asOf, date);
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  if (d > 1) return `due in ${d} days`;
  return `overdue by ${plural(-d, "day")}`;
}

/** Hrefs of the loop stages' preset views (§5.1). */
export const LOOP_HREF = {
  triage: "/items?view=needs-action",
  draft: "/items?view=draft-ready",
  approve: "/approvals",
  file: "/reports?filter=approved",
} as const;

export function nextAction(input: NextActionInput): NextAction {
  const { counts, asOf } = input;
  const known = (n: number | null): n is number => n !== null;

  if (!known(counts.triage) && !known(counts.draft) && !known(counts.approve) && !known(counts.file)) {
    return { kind: "setup", label: "Connect a ledger to start", detail: null, href: "/settings/integrations", count: null, human: false };
  }

  const approve = counts.approve ?? 0;
  if (approve > 0 && input.urgentApprovals > 0) {
    return {
      kind: "approve_urgent",
      label: `Approve ${plural(input.urgentApprovals, "item")}`,
      detail: input.urgentDeadline ? duePhrase(asOf, input.urgentDeadline) : `due within ${URGENT_DAYS} days`,
      href: LOOP_HREF.approve,
      count: input.urgentApprovals,
      human: true,
    };
  }
  if (approve > 0) {
    return { kind: "approve", label: `Review ${plural(approve, "approval")}`, detail: "waiting on you", href: LOOP_HREF.approve, count: approve, human: true };
  }
  const draft = counts.draft ?? 0;
  if (draft > 0) {
    return { kind: "draft", label: `Draft letters for ${plural(draft, "item")}`, detail: "due diligence window open", href: LOOP_HREF.draft, count: draft, human: false };
  }
  const file = counts.file ?? 0;
  if (file > 0) {
    return { kind: "file", label: `File ${plural(file, "approved report")}`, detail: "ready for the state portal", href: LOOP_HREF.file, count: file, human: false };
  }
  if (input.unverifiedBlocking > 0) {
    return {
      kind: "verify_rules",
      label: "Verify rule values",
      detail: `${plural(input.unverifiedBlocking, "date")} provisional`,
      href: "/rules",
      count: input.unverifiedBlocking,
      human: false,
    };
  }
  return {
    kind: "all_clear",
    label: "All clear",
    detail: input.nextDeadline ? `Next deadline ${formatDate(input.nextDeadline)}` : "No upcoming deadlines",
    href: "/forecast",
    count: null,
    human: false,
  };
}
