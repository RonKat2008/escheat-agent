/**
 * Ask starter chips (docs/ASK-MODE.md §1.4), slice 1: built only from real state and only from prompts today's chat
 * tools answer. Pure and client-safe. The order is fixed and the list is capped at 6. A hint is a count over real rows
 * ("3 waiting"), never a legal date or value. Coral (`human`) means a person must act; steel (`info`) only reads.
 */
import { answerableOffline } from "@/lib/chat/offline-intent";
import { hasRecordedAnswer } from "@/lib/chat/recorded-prompts";
import { CLOSE_OUT_PROMPTS } from "@/components/chat/followups";

export const MAX_STARTERS = 6;
/** At most this many close-out chips, so the two always-on reads are never pushed out by the cap. */
export const MAX_CLOSE_OUT_STARTERS = 2;

export const EXPOSURE_PROMPT = "What do we owe and where?";
export const DEADLINES_PROMPT = "What's due in the next 90 days?";
export const APPROVALS_PROMPT = "What needs my approval?";

export type StarterTone = "human" | "info";

export interface AskStarter {
  prompt: string;
  tone: StarterTone;
  /** A count over real rows, e.g. "3 waiting". Never a date, an amount or a legal value. */
  hint?: string;
}

export interface StarterState {
  /** Approvals queue count (the same definition as the coral nav badge). */
  approvalsWaiting: number;
  /** Items in an open due-diligence window with no live outreach (the Loop Bar's Draft count). */
  draftReady: number;
  /** Check number of the first of those items, if it has one. */
  draftCheck: string | null;
  /** Owner states with To Report items, most items first: { state, count }. */
  toReport: readonly { state: string; count: number }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function askStarters(s: StarterState): AskStarter[] {
  const out: AskStarter[] = [];
  if (s.approvalsWaiting > 0) out.push({ prompt: APPROVALS_PROMPT, tone: "human", hint: `${s.approvalsWaiting} waiting` });
  if (s.draftReady > 0 && s.draftCheck) {
    out.push({ prompt: `Draft the due-diligence letter for #${s.draftCheck}`, tone: "human", hint: plural(s.draftReady, "letter can be drafted", "letters can be drafted") });
  }
  const closeOuts = s.toReport
    .filter((r) => r.count > 0)
    .flatMap((r) => {
      const p = CLOSE_OUT_PROMPTS.find((c) => c.state === r.state);
      return p ? [{ prompt: p.prompt, tone: "info" as const, hint: plural(r.count, "item to report", "items to report") }] : [];
    })
    .slice(0, MAX_CLOSE_OUT_STARTERS);
  out.push(...closeOuts);
  out.push({ prompt: EXPOSURE_PROMPT, tone: "info" }, { prompt: DEADLINES_PROMPT, tone: "info" });
  return out.slice(0, MAX_STARTERS);
}

/** Offline chat answers recorded first questions, or known shapes directly from the data (the EmptyChat filter). */
export const offlineAnswerable = (prompt: string): boolean => hasRecordedAnswer([], prompt) || answerableOffline(prompt);

/**
 * The chips to show for the current availability. Offline, only prompts offline chat can answer survive, so Ask never
 * suggests something it cannot answer; the exposure question is always kept as the fallback.
 */
export function startersFor(starters: readonly AskStarter[], offline: boolean): AskStarter[] {
  if (!offline) return [...starters];
  const kept = starters.filter((s) => offlineAnswerable(s.prompt));
  return kept.length ? kept : [{ prompt: EXPOSURE_PROMPT, tone: "info" }];
}
