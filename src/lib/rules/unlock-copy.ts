/**
 * R5-01: the plain-language "what this approval unlocked" line, from the live bulk pre-flight (draftableLetters).
 * Pure. It only words counts the pre-flight produced: items the state requires no notice for are said to need no
 * letter, notices whose window has not opened are named with their opening date, and nothing is ever called
 * "draftable" unless the same check every draft path runs says so.
 */
import { humanDate } from "@/lib/outreach/bulk-plan";
import { formatUSD } from "@/lib/money";
import type { DraftableLetters } from "./adopt";

export interface UnlockCopy {
  /** e.g. "2 TX letters can now be drafted" or "No TX letter can be drafted yet". */
  headline: string;
  /** Money for the headline (null when nothing is draftable). */
  amountCents: number | null;
  /** Supporting facts, one sentence each. */
  lines: string[];
  /** Where to act next, only when something can be acted on now. */
  cta: { href: string; label: string } | null;
}

const letters = (n: number) => `${n} ${n === 1 ? "letter" : "letters"}`;

export function unlockCopy(stateInput: string, d: DraftableLetters): UnlockCopy {
  const st = stateInput.toUpperCase();
  const lines: string[] = [];
  const next = d.upcoming.next;
  if (next) {
    const more = d.upcoming.count - 1;
    lines.push(
      `Next ${st} notice opens ${humanDate(next.opensOn)}: ${next.payeeName} (${formatUSD(next.amountCents)}).${more > 0 ? ` ${more} more ${more === 1 ? "opens" : "open"} after that.` : ""}`,
    );
  }
  const exempt = d.noNoticeRequired;
  if (exempt.count > 0) {
    const why = exempt.minAmountCents !== null ? `below ${st}'s ${formatUSD(exempt.minAmountCents)} notice minimum` : `not ones ${st} requires a notice for`;
    lines.push(`${exempt.count} ${st} ${exempt.count === 1 ? "item" : "items"} (${formatUSD(exempt.amountCents)}) ${exempt.count === 1 ? "is" : "are"} ${why}, so no letter is required.`);
  }
  if (d.count > 0) {
    return {
      headline: `${d.count} ${st} ${d.count === 1 ? "letter" : "letters"} can now be drafted`,
      amountCents: d.amountCents,
      lines,
      cta: { href: `/items?state=${st}&status=dd_pending`, label: `Draft the ${letters(d.count)} from Items` },
    };
  }
  return {
    headline: `No ${st} letter can be drafted yet`,
    amountCents: null,
    lines: lines.length ? lines : [`No open ${st} item needs a notice right now.`],
    cta: null,
  };
}
