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

export const agentLabel = (a: string): string => AGENT_LABEL[a] ?? a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const AGENT_TASK: Record<string, string> = {
  classifier: "Classify a stale item",
  rule_research: "Research a state rule",
  letter_writer: "Draft a due-diligence letter",
  payee_resolver: "Resolve a payee",
  reply_parser: "Read an owner reply",
  claim_agent: "File a recovery claim",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One short sentence describing what the run was asked to do, from its recorded input. */
export function runTask(agent: string, input: unknown): string | null {
  const i = isObj(input) ? input : {};
  if (agent === "filing_agent") return typeof i.state === "string" ? `File the ${i.state} holder report` : "File a holder report";
  if (agent === "recovery_agent") {
    if (Array.isArray(i.states) && i.states.length) return `Search ${i.states.join(", ")} for company property`;
    if (typeof i.recoveryId === "string") return "File a recovery claim";
    return "Search state databases for company property";
  }
  return AGENT_TASK[agent] ?? null;
}

export const isScripted = (input: unknown, model: string | null): boolean => (isObj(input) && input.mode === "scripted") || model === "scripted";

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
