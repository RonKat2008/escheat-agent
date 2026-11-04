/** Pure display helpers for agent runs. Never invents a value: anything not recorded reads as null. */

const AGENT_LABEL: Record<string, string> = {
  filing_agent: "Filing agent",
  recovery_agent: "Recovery agent",
  claim_agent: "Claim agent",
  classifier: "Classifier",
  rule_research: "Rule research",
  letter_writer: "Letter writer",
  payee_resolver: "Payee resolver",
  reply_parser: "Reply parser",
};

/** Agents are recorded as "letter-writer" or "letter_writer"; look them up by one spelling. */
const agentKey = (a: string): string => a.replace(/-/g, "_");

export const agentLabel = (a: string): string =>
  AGENT_LABEL[agentKey(a)] ?? agentKey(a).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const AGENT_TASK: Record<string, string> = {
  classifier: "Classify a stale item",
  rule_research: "Research a state rule",
  letter_writer: "Draft a due-diligence letter",
  payee_resolver: "Resolve a payee",
  reply_parser: "Read an owner reply",
  claim_agent: "File a recovery claim",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The check/reference number in a model run's recorded request preview ("number":"10087"), if there is one. */
function itemNumber(input: Record<string, unknown>): string | null {
  const req = isObj(input.request) ? input.request : {};
  const m = typeof req.lastUserPreview === "string" ? /"number"\s*:\s*"(\w+)"/.exec(req.lastUserPreview) : null;
  return m?.[1] ?? null;
}

const TASK_QUESTION_MAX = 80;

/** A chat run's recorded question (the last user message), quoted and clipped for one table cell. */
function chatQuestion(input: Record<string, unknown>): string | null {
  const req = isObj(input.request) ? input.request : {};
  const q = typeof req.lastUserPreview === "string" ? req.lastUserPreview.replace(/\s+/g, " ").trim() : "";
  if (!q) return null;
  const clipped = q.length > TASK_QUESTION_MAX ? `${q.slice(0, TASK_QUESTION_MAX - 1).trimEnd()}…` : q;
  return `Answer “${clipped}”`;
}

/** One short sentence describing what the run was asked to do, from its recorded input. */
export function runTask(rawAgent: string, input: unknown): string | null {
  const agent = agentKey(rawAgent);
  const i = isObj(input) ? input : {};
  if (agent === "chat") return chatQuestion(i) ?? "Answer a chat question";
  const num = itemNumber(i);
  if (num && agent === "letter_writer") return `Compose letter for #${num}`;
  if (num && (agent === "classifier" || agent === "classifier_escalation")) return `Classify #${num}`;
  if (agent === "filing_agent") return typeof i.state === "string" ? `File the ${i.state} holder report` : "File a holder report";
  if (agent === "recovery_agent") {
    if (Array.isArray(i.states) && i.states.length) return `Search ${i.states.join(", ")} for company property`;
    if (typeof i.recoveryId === "string") return "File a recovery claim";
    return "Search state databases for company property";
  }
  return AGENT_TASK[agent] ?? null;
}

/**
 * An offline replay that had no recorded answer. It is stored as "cancelled" (the model was never called and nothing
 * failed), but it is a replay, not a cancellation: the Runs page labels it "Replayed" and tucks it away by default.
 */
export const isSkippedReplay = (status: string, input: unknown): boolean => status === "cancelled" && isReplay(input);

/** Where the human gate for a paused run lives. Filing gates are on Reports (per state), not Approvals. */
export function gateHref(agent: string, input: unknown, reportState: string | null): { href: string; label: string } {
  if (agent === "filing_agent") {
    const raw = reportState ?? (isObj(input) && typeof input.state === "string" ? input.state : null);
    const state = raw?.toUpperCase();
    return { href: state ? `/reports?state=${state}` : "/reports", label: "Review on Reports" };
  }
  if (agent === "claim_agent") return { href: "/recoveries", label: "Review on Recoveries" };
  return { href: "/approvals", label: "Review in Approvals" };
}

export const isScripted = (input: unknown, model: string | null): boolean => (isObj(input) && input.mode === "scripted") || model === "scripted";

/** True when the run was answered from a recorded cassette (offline replay): no model call, no billing. */
export const isReplay = (input: unknown): boolean => isObj(input) && input.mode === "replay";

export interface CostCell {
  /** What the cell shows: "Not billed", a formatted cost, or null for "not recorded". */
  kind: "not_billed" | "cost" | "unknown";
  micros: number | null;
  title: string;
}

/**
 * One rule for every cost cell (R5-22): a run that made no model call (an offline replay or a scripted run) reads
 * "Not billed", whatever it stored (scripted runs store 0); a model run shows its recorded cost; otherwise unknown.
 */
export function costCell(run: { input: unknown; model: string | null; costUsdMicros: number | null }, tokens = 0): CostCell {
  if (isReplay(run.input)) return { kind: "not_billed", micros: null, title: "Offline replay of a recorded answer: no model call, not billed" };
  if (isScripted(run.input, run.model)) return { kind: "not_billed", micros: null, title: "Scripted run: no model calls, not billed" };
  if (run.costUsdMicros != null) return { kind: "cost", micros: run.costUsdMicros, title: tokens ? `${tokens.toLocaleString("en-US")} tokens` : "Model cost" };
  return { kind: "unknown", micros: null, title: "Cost not recorded" };
}

export const stepCount = (trace: unknown): number => (Array.isArray(trace) ? trace.filter(isObj).length : 0);

/** "+0.4s", "+12.3s", "+1m 04s" offset from the run start. */
export function formatOffset(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "+0.0s";
  const s = ms / 1000;
  if (s < 60) return `+${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `+${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/** "just now", "4m ago", "3h ago", "2d ago", else a short date. */
export function relativeTime(at: Date, now: number = Date.now()): string {
  const diff = Math.max(0, now - at.getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Oct 31, 2026, 11:21:27 UTC" for hover titles. */
export const absoluteTime = (at: Date): string =>
  `${at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
