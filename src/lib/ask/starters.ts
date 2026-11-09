/**
 * Ask starter chips (docs/ASK-MODE.md §1.4): built only from real state and only from prompts Ask answers today
 * (chat tools, or the action cards in src/lib/ask/cards, which need no model). Pure and client-safe. The order is fixed
 * and the list is capped at 6, with the two always-on reads never pushed out. A hint is a count over real rows
 * ("3 waiting"), never a legal date or value. Coral (`human`) means a person must act; steel (`info`) only reads.
 */
import { answerableOffline } from "@/lib/chat/offline-intent";
import { hasRecordedAnswer } from "@/lib/chat/recorded-prompts";
import { CLOSE_OUT_PROMPTS } from "@/components/chat/followups";
import { isCardPrompt } from "./cards/intent";
import { ASK_CARDS, CARD_PROMPT, fileReportPrompt } from "./cards/registry";

export const MAX_STARTERS = 6;
/** At most this many close-out chips, so the two always-on reads are never pushed out by the cap. */
export const MAX_CLOSE_OUT_STARTERS = 2;

export const EXPOSURE_PROMPT = "What do we owe and where?";
export const DEADLINES_PROMPT = "What's due in the next 90 days?";
export const APPROVALS_PROMPT = "What needs my approval?";
export const GET_STARTED_PROMPT = CARD_PROMPT.getting_started;
export const UPLOAD_PROMPT = CARD_PROMPT.import_csv;
export const OVERDUE_PROMPT = CARD_PROMPT.needs_you;
export const INTEGRATIONS_PROMPT = CARD_PROMPT.integrations;

/** The always-on reads at the end of the list. */
const READS = 2;

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
  /** Of those, letters that still need composing before they can be approved (R11-06). Omitted: unknown. */
  approvalsToCompose?: number;
  /** Items in an open due-diligence window with no live outreach (the Loop Bar's Draft count). */
  draftReady: number;
  /** Check number of the first of those items, if it has one. */
  draftCheck: string | null;
  /** Owner states with To Report items, most items first: { state, count }. */
  toReport: readonly { state: string; count: number }[];
  /** Ledger rows stored. Omitted: unknown, so no upload chip. */
  ledgerRows?: number;
  /** Items past a deadline (src/lib/queries/overdue.ts). */
  overdue?: number;
  /** Getting-started steps done (src/lib/ask/cards/data.ts). 0 puts "Get started" first. Omitted: unknown. */
  setupDone?: number;
  setupTotal?: number;
  /** QuickBooks and Plaid both not configured (docs/ASK-MODE.md §1.4). */
  integrationsUnconfigured?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 waiting", "2 to compose", or "1 ready, 2 to compose": the counts the review card and the draft card show. */
export function approvalsHint(waiting: number, toCompose: number): string {
  if (toCompose <= 0) return `${waiting} waiting`;
  if (toCompose >= waiting) return `${waiting} to compose`;
  return `${waiting - toCompose} ready, ${toCompose} to compose`;
}

export function askStarters(s: StarterState): AskStarter[] {
  const actions: AskStarter[] = [];
  if (s.setupDone === 0) actions.push({ prompt: GET_STARTED_PROMPT, tone: "human", hint: `${s.setupTotal ?? 4} steps to do` });
  if (s.ledgerRows === 0) actions.push({ prompt: UPLOAD_PROMPT, tone: "human", hint: "0 ledger rows" });
  if ((s.overdue ?? 0) > 0) actions.push({ prompt: OVERDUE_PROMPT, tone: "human", hint: `${s.overdue} overdue` });
  if (s.approvalsWaiting > 0) actions.push({ prompt: APPROVALS_PROMPT, tone: "human", hint: approvalsHint(s.approvalsWaiting, s.approvalsToCompose ?? 0) });
  if (s.draftReady > 0 && s.draftCheck) {
    actions.push({ prompt: `Draft the due-diligence letter for #${s.draftCheck}`, tone: "human", hint: plural(s.draftReady, "letter can be drafted", "letters can be drafted") });
  }
  const closeOuts = s.toReport
    .filter((r) => r.count > 0)
    .flatMap((r) => {
      const p = CLOSE_OUT_PROMPTS.find((c) => c.state === r.state);
      return p ? [{ prompt: p.prompt, tone: "info" as const, hint: plural(r.count, "item to report", "items to report") }] : [];
    })
    .slice(0, MAX_CLOSE_OUT_STARTERS);
  actions.push(...closeOuts);
  const out: AskStarter[] = [...actions.slice(0, MAX_STARTERS - READS), { prompt: EXPOSURE_PROMPT, tone: "info" }, { prompt: DEADLINES_PROMPT, tone: "info" }];
  if (s.integrationsUnconfigured && out.length < MAX_STARTERS) out.push({ prompt: INTEGRATIONS_PROMPT, tone: "info" });
  return out;
}

/**
 * Offline chat answers recorded first questions, known shapes directly from the data (the EmptyChat filter), and the
 * Ask action cards (no model at all).
 */
export const offlineAnswerable = (prompt: string): boolean => hasRecordedAnswer([], prompt) || answerableOffline(prompt) || isCardPrompt(prompt);

/**
 * The chips to show for the current availability. Offline, only prompts offline chat can answer survive, so Ask never
 * suggests something it cannot answer; the exposure question is always kept as the fallback.
 */
export function startersFor(starters: readonly AskStarter[], offline: boolean): AskStarter[] {
  if (!offline) return [...starters];
  const kept = starters.filter((s) => offlineAnswerable(s.prompt));
  return kept.length ? kept : [{ prompt: EXPOSURE_PROMPT, tone: "info" }];
}

/** Golden-path order for a keyless install (R11-05): setup first, then the approval loop, then close and file. */
const KEYLESS_ORDER = ["getting_started", "import_csv", "draft_outreach", "review_approvals", "close_month", "file_report"] as const;

/** The state a close-out chip is for ("Close out California ..." -> "CA"), so the file chip follows the real pool. */
const stateOfCloseOut = (prompt: string): string | null => CLOSE_OUT_PROMPTS.find((c) => c.prompt === prompt)?.state ?? null;

/**
 * The landing chips when no model key is set (R11-05): only the Ask cards, which work without a model, in golden-path
 * order. No disabled chip is ever shown. Hints and the coral tone are kept only where `starters` (real state) says a
 * person has something to do; otherwise the chip is a steel reader. "File the XX report" uses the state with the most
 * items to report (the first close-out chip), CA when there is none.
 */
export function keylessStarters(starters: readonly AskStarter[]): AskStarter[] {
  const byPrompt = new Map(starters.map((s) => [s.prompt, s]));
  const fileState = starters.map((s) => stateOfCloseOut(s.prompt)).find((s): s is string => s !== null) ?? "CA";
  const draft = starters.find((s) => s.prompt.startsWith("Draft the due-diligence letter"));
  return KEYLESS_ORDER.map((id): AskStarter => {
    if (id === "draft_outreach") return { prompt: CARD_PROMPT.draft_outreach, tone: draft?.tone ?? "info", ...(draft?.hint ? { hint: draft.hint } : {}) };
    if (id === "file_report") {
      const closeOut = starters.find((s) => stateOfCloseOut(s.prompt) === fileState);
      return { prompt: fileReportPrompt(fileState), tone: "info", ...(closeOut?.hint ? { hint: closeOut.hint } : {}) };
    }
    // The approvals chip keeps its plain-language prompt (it matches the review_approvals intent).
    const prompt = id === "review_approvals" ? APPROVALS_PROMPT : CARD_PROMPT[id];
    const own = byPrompt.get(prompt);
    return { prompt, tone: own?.tone ?? "info", ...(own?.hint ? { hint: own.hint } : {}) };
  });
}

/** Every phrase that opens a card without a model, straight from the registry so the hint cannot drift (R11-05). */
export const noModelPhrases = (): string[] => ASK_CARDS.map((c) => c.prompt);

/** "“Get started”, “Upload a ledger CSV”, ... or “File the CA report”". */
export function noModelPhraseList(): string {
  const q = noModelPhrases().map((p) => `\u201c${p}\u201d`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} or ${q.at(-1)}` : (q[0] ?? "");
}
