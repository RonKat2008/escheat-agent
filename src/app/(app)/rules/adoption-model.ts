import { formatUSD } from "@/lib/money";
import type { DraftSkipCode } from "@/lib/outreach/bulk-plan";
import type { AdoptionImpact } from "@/lib/rules/adopt";

/**
 * View model for the R3-05 "Use official text" review. Pure: no fetch, no React. Every string here is derived from
 * the server's AdoptionPreview (src/lib/rules/adopt.ts); nothing is paraphrased or invented.
 */

export const MIN_APPROVER_CHARS = 2;

export interface TextSegment {
  text: string;
  /** True for the part of the source quote that becomes the rule value verbatim. */
  match: boolean;
}

/** Splits a source quote around the exact proposed text so the UI can highlight it in place. */
export function quoteSegments(quote: string, proposed: string): TextSegment[] {
  const at = proposed ? quote.indexOf(proposed) : -1;
  if (at < 0) return [{ text: quote, match: false }];
  return [
    { text: quote.slice(0, at), match: false },
    { text: proposed, match: true },
    { text: quote.slice(at + proposed.length), match: false },
  ].filter((s) => s.text.length > 0);
}

export type DiffKind = "same" | "removed" | "added";
export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

const tokens = (s: string) => s.match(/\S+|\s+/g) ?? [];

/**
 * Word-level diff (LCS over words and whitespace runs) between the current value and the proposed one. A null
 * "before" (the value is unknown today) yields only an "added" segment: there is nothing to strike through.
 */
export function diffSegments(before: string | null, after: string): DiffSegment[] {
  if (before === null || before === "") return after ? [{ kind: "added", text: after }] : [];
  const a = tokens(before);
  const b = tokens(after);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const out: DiffSegment[] = [];
  const push = (kind: DiffKind, text: string) => {
    const last = out.at(-1);
    if (last && last.kind === kind) out[out.length - 1] = { kind, text: last.text + text };
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push("removed", a[i++]!);
    else push("added", b[j++]!);
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return out;
}

export const SKIP_REASON: Record<DraftSkipCode, [string, string]> = {
  rule_unknown: ["another rule value is still unknown", "other rule values are still unknown"],
  notice_not_required: ["the state requires no owner notice for it", "the state requires no owner notice for them"],
  window_not_open: ["the notice window has not opened yet", "the notice window has not opened yet"],
  already_drafted: ["a letter is already drafted", "letters are already drafted"],
  closed: ["the item is closed", "the items are closed"],
  missing_owner_address: ["the owner has no mailing address", "the owners have no mailing address"],
  owner_state_unknown: ["the owner's state is unknown", "the owners' state is unknown"],
  not_found: ["the item was not found", "the items were not found"],
};

const letters = (n: number) => `${n} ${n === 1 ? "letter" : "letters"}`;

export interface ImpactCopy {
  /** e.g. "2 TX letters ($750.50) become draftable; 2 stay blocked." */
  headline: string;
  /** One reason per skip code, e.g. "1: the owner has no mailing address". */
  reasons: string[];
  draftableCount: number;
  stillBlockedCount: number;
}

/** Plain-language outreach impact of adopting the value. Null when the field does not gate letters. */
export function impactCopy(state: string, impact: AdoptionImpact | null): ImpactCopy | null {
  if (!impact) return null;
  const st = state.toUpperCase();
  const { becomeDraftable: ok, stillBlocked: still, blockedByRule } = impact;
  if (blockedByRule.count === 0) {
    return { headline: `No ${st} letters are blocked by this rule right now.`, reasons: [], draftableCount: 0, stillBlockedCount: 0 };
  }
  const first =
    ok.count > 0
      ? `${ok.count} ${st} ${ok.count === 1 ? "letter" : "letters"} (${formatUSD(ok.amountCents)}) ${ok.count === 1 ? "becomes" : "become"} draftable`
      : `No ${st} letters become draftable yet`;
  const second = still.count > 0 ? `; ${still.count} ${still.count === 1 ? "stays" : "stay"} blocked (${formatUSD(still.amountCents)})` : "";
  const reasons = (Object.entries(still.byReason) as [DraftSkipCode, number][])
    .filter(([, n]) => n > 0)
    .sort((x, y) => y[1] - x[1])
    .map(([code, n]) => `${letters(n)}: ${SKIP_REASON[code]?.[n === 1 ? 0 : 1] ?? code.replace(/_/g, " ")}`);
  return { headline: `${first}${second}.`, reasons, draftableCount: ok.count, stillBlockedCount: still.count };
}

/** The official text speaks to the holder ("You (the holder)") rather than to the owner who will read the letter. */
export function addressedToHolder(text: string): boolean {
  return /\(the holder\)|\bthe holder\b/i.test(text);
}

export const canApprove = (name: string): boolean => name.trim().length >= MIN_APPROVER_CHARS;
