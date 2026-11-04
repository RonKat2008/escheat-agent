/**
 * Offline intent mapping (dogfood R6-03). When offline replay cannot answer (the demo data changed since the recording,
 * or the question was asked at a position with no recording), a small set of KNOWN question shapes is mapped to the
 * existing chat tools, which then run live against the database. No model is involved and nothing here decides law:
 * this only picks which deterministic tool to call and with which arguments (a check number or a state code typed by
 * the user). Anything that does not match one of these shapes returns null, and chat says there is no recorded answer.
 *
 * Pure and client-safe (the chat UI uses it to decide which follow-up chips can be answered offline).
 */
import { US_STATES, isUsState } from "@/lib/rules/priority";

export type OfflineIntentId = "close_out" | "draft_letter" | "generate_report" | "explain_item" | "unverified_rules" | "deadlines" | "exposure";

export interface OfflineToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface OfflineIntent {
  id: OfflineIntentId;
  calls: OfflineToolCall[];
}

const NAME_TO_CODE: ReadonlyMap<string, string> = new Map(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));
// Longest names first so "West Virginia" wins over "Virginia".
const NAMES_LONGEST_FIRST = [...NAME_TO_CODE.keys()].sort((a, b) => b.length - a.length);

/** A state named in full ("Texas") or as an upper-case code ("TX"). Null when none or ambiguous input. */
export function stateIn(text: string): string | null {
  const lower = text.toLowerCase();
  for (const name of NAMES_LONGEST_FIRST) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return NAME_TO_CODE.get(name)!;
  }
  for (const m of text.matchAll(/\b([A-Z]{2})\b/g)) {
    const code = m[1]!;
    if (isUsState(code)) return code;
  }
  return null;
}

/** A check number ("#10482", "check 10482"). Four or more digits, so "90 days" never reads as a check. */
export function checkIn(text: string): string | null {
  return /#\s*(\d{3,})\b/.exec(text)?.[1] ?? /\b(\d{4,})\b/.exec(text)?.[1] ?? null;
}

const DAYS_RE = /\b(\d{1,3})\s*(?:-|\s)?days?\b/;
const MAX_DAYS = 730;

/** Questions that LOOK like exposure but ask something the exposure tool does not answer. */
const NOT_EXPOSURE = /\b(interest|penalt\w*|forecast|next year|recover\w*|refund|claim)\b/;

/**
 * Maps one user question to the tool calls that answer it from the database. Order matters: the most specific shapes
 * are tried first ("draft the due-diligence letter for #10087" must not read as a deadline question).
 */
export function matchOfflineIntent(raw: string): OfflineIntent | null {
  const text = raw.trim();
  if (!text) return null;
  const q = text.toLowerCase().replace(/[’‘]/g, "'");
  const state = stateIn(text);
  const check = checkIn(text);

  if (/\bclose[\s-]?out\b|\bclose\s+(?:the\s+)?cycle\b|\bwhat'?s left (?:to close|for)\b/.test(q)) {
    return state ? { id: "close_out", calls: [{ name: "plan_close_out", input: { state } }] } : null;
  }
  if (/\bdraft\b/.test(q) && /\b(letter|due[\s-]?diligence|notice)\b/.test(q)) {
    return check ? { id: "draft_letter", calls: [{ name: "create_outreach_draft", input: { item: check } }] } : null;
  }
  if (/\b(generate|build|prepare|create|make)\b/.test(q) && /\breport\b/.test(q)) {
    return state ? { id: "generate_report", calls: [{ name: "generate_report", input: { state } }] } : null;
  }
  if (check && /\b(explain|why|what about|tell me about|walk me through)\b|\bcheck\s*#?\s*\d/.test(q)) {
    return { id: "explain_item", calls: [{ name: "explain_item", input: { item: check } }] };
  }
  if (/\bunverified\b/.test(q) || (/\brules?\b/.test(q) && /\bverif\w*\b/.test(q))) {
    return { id: "unverified_rules", calls: [{ name: "list_rules", input: state ? { state } : {} }] };
  }
  if (!/due[\s-]?diligence/.test(q) && /\b(due|deadlines?|coming up)\b/.test(q)) {
    const days = Number(DAYS_RE.exec(q)?.[1] ?? 90);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return null;
    return { id: "deadlines", calls: [{ name: "upcoming_deadlines", input: { days } }] };
  }
  if (/\b(owe|owed|exposure|liabilit(?:y|ies))\b/.test(q) && !NOT_EXPOSURE.test(q)) {
    return { id: "exposure", calls: [{ name: "get_exposure", input: state ? { state } : {} }] };
  }
  return null;
}

/** True when offline chat can answer `prompt` directly from the data (no recording needed). */
export const answerableOffline = (prompt: string): boolean => matchOfflineIntent(prompt) !== null;
