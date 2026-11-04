/**
 * "Watch it work": turns one stored agent run trace (agent_runs.trace) into an ordered list of theater steps placed on
 * the fixed pipeline. Pure and deterministic. It never invents a step: every trace entry becomes exactly one step (so
 * the step count always equals the trace length), and anything the trace did not record reads as null.
 */
import { safeHttpUrl } from "@/components/b/trace";

export const STAGES = ["ingest", "reconcile", "classify", "rules", "draft", "approval", "execute"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  ingest: "Ingest",
  reconcile: "Reconcile",
  classify: "Classify",
  rules: "Rules engine",
  draft: "Draft",
  approval: "Human approval gate",
  execute: "Execute",
};

/** Who did the step. "model" = an LLM call; "rules" = the deterministic, versioned rules engine (never the model). */
export type Actor = "model" | "rules" | "tool" | "browser" | "person" | "system";

export const ACTOR_LABEL: Record<Actor, string> = {
  model: "Model",
  rules: "Rules engine",
  tool: "App tool",
  browser: "Browser (replica)",
  person: "Person",
  system: "System",
};

export type OutcomeTone = "ok" | "error" | "wait" | "neutral";

export interface TheaterCitation {
  url: string;
  title: string;
}

/** The versioned rule file a rules-engine step read (filled server-side from rules/, never by the model). */
export interface RuleRef {
  state: string;
  version: string;
  /** True only when every value in the file is human-verified. */
  verified: boolean;
  unverifiedCount: number;
  sourceUrls: string[];
}

export interface TheaterStep {
  /** Position in the stored trace array. */
  index: number;
  /** Raw recorded kind (`type` or `kind`), or "unknown" for an entry with neither. */
  kind: string;
  /** False when the kind is not one the theater knows; the step still shows, labelled honestly. */
  knownKind: boolean;
  label: string;
  tool: string | null;
  stage: Stage;
  actor: Actor;
  inputs: string | null;
  outcome: { tone: OutcomeTone; text: string | null };
  citations: TheaterCitation[];
  /** True when the step itself says a value is unverified (rule research, "UNVERIFIED" in a message). */
  unverified: boolean;
  /** State code a rules step refers to, when recorded. */
  ruleState: string | null;
  ruleVersion: string | null;
  ruleRef: RuleRef | null;
  at: string | null;
  /** Milliseconds from the run start, when the step has a timestamp. */
  offsetMs: number | null;
  durationMs: number | null;
  /** The run's model, on model steps only. */
  model: string | null;
  /** Token usage the step itself recorded (chat model calls do); null when not recorded per step. */
  tokens: { input: number; output: number } | null;
}

export interface RunForSteps {
  agent: string;
  model: string | null;
  input: unknown;
  trace: unknown;
  startedAt: Date | string;
  finishedAt: Date | string | null;
}

const KNOWN_KINDS = new Set([
  "request",
  "model_call",
  "tool_call",
  "research_done",
  "result",
  "citations",
  "retry",
  "offline_answer",
  "navigate",
  "action",
  "extract",
  "screenshot",
  "guard_blocked",
  "dev_noise",
  "info",
  "done",
  "error",
  "paused",
  "approval",
]);

const MODEL_KINDS = new Set(["request", "model_call", "research_done", "result", "citations", "retry", "offline_answer"]);
const BROWSER_KINDS = new Set(["navigate", "action", "extract", "screenshot", "guard_blocked", "dev_noise"]);

const AGENT_STAGE: Record<string, Stage> = {
  classifier: "classify",
  classifier_escalation: "classify",
  rule_research: "rules",
  letter_writer: "draft",
  payee_resolver: "reconcile",
  reply_parser: "ingest",
  filing_agent: "execute",
  recovery_agent: "execute",
  claim_agent: "execute",
  chat: "ingest",
};

/** Chat/app tool names to the stage they serve. Unknown tools fall through to the keyword match. */
const TOOL_STAGE: Record<string, Stage> = {
  get_exposure: "reconcile",
  list_stale_items: "reconcile",
  explain_item: "reconcile",
  get_forecast: "reconcile",
  upcoming_deadlines: "rules",
  list_rules: "rules",
  get_audit_interest_exposure: "rules",
  web_search: "rules",
  plan_close_out: "draft",
  create_outreach_draft: "draft",
  generate_report: "draft",
  list_reports: "draft",
  list_pending_approvals: "approval",
  start_recovery_search: "execute",
  list_recoveries: "execute",
};

/** Keyword match over a tool name or a step message. Approval wins: anything waiting on a person is the gate. */
const STAGE_PATTERNS: Array<[RegExp, Stage]> = [
  [/approv|awaiting a person|needs a person|paused/i, "approval"],
  [/\brules?\b|dormancy|deadline|statute|web_search/i, "rules"],
  [/classif/i, "classify"],
  [/reconcil|stale items? detected|\bmatch(ed|ing)?\b|exposure/i, "reconcile"],
  [/ingest|import|upload|csv|ledger/i, "ingest"],
  [/draft|letter|compose|generat|report\b/i, "draft"],
  [/\bsend|submit|\bfile\b|filing|portal|lob|mail|remit|claim/i, "execute"],
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const agentKey = (a: string): string => a.replace(/-/g, "_");
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

const humanize = (s: string): string => s.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

function matchStage(text: string | null): Stage | null {
  if (!text) return null;
  for (const [re, stage] of STAGE_PATTERNS) if (re.test(text)) return stage;
  return null;
}

const INPUT_MAX = 140;

/** One short line summarizing the recorded inputs: `key: value` pairs, values clipped. Never more than recorded. */
export function summarizeInputs(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return clip(v);
  if (!isObj(v)) return clip(JSON.stringify(v));
  const parts: string[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val == null || val === "") continue;
    const text = typeof val === "string" ? val : typeof val === "number" || typeof val === "boolean" ? String(val) : JSON.stringify(val);
    parts.push(`${k}: ${text.replace(/\s+/g, " ")}`);
  }
  return parts.length ? clip(parts.join(", ")) : null;
}

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > INPUT_MAX ? `${t.slice(0, INPUT_MAX - 1).trimEnd()}…` : t;
}

function citationsOf(e: Record<string, unknown>): TheaterCitation[] {
  const out = new Map<string, TheaterCitation>();
  const add = (c: unknown) => {
    if (!isObj(c)) return;
    const url = safeHttpUrl(c.url ?? c.source_url ?? c.sourceUrl);
    if (!url || out.has(url)) return;
    out.set(url, { url, title: str(c.title) ?? new URL(url).hostname });
  };
  const data = isObj(e.data) ? e.data : {};
  for (const list of [e.citations, e.sources, data.citations, data.sources]) if (Array.isArray(list)) list.forEach(add);
  const direct = safeHttpUrl(e.source_url ?? data.source_url ?? data.sourceUrl);
  if (direct && !out.has(direct)) out.set(direct, { url: direct, title: new URL(direct).hostname });
  return [...out.values()];
}

/** "Loaded CA rules @ 2026.10.0-draft" or a tool input `{ state: "TX" }`. */
function ruleTarget(e: Record<string, unknown>, label: string): { state: string | null; version: string | null } {
  const input = isObj(e.input) ? e.input : isObj(e.data) ? e.data : {};
  const fromInput = str(input.state)?.toUpperCase() ?? null;
  const m = /\b([A-Z]{2}) rules?(?: @ ([\w.+-]+))?/.exec(label);
  const state = fromInput && /^[A-Z]{2}$/.test(fromInput) ? fromInput : (m?.[1] ?? null);
  return { state, version: str(input.version) ?? m?.[2] ?? null };
}

interface Raw {
  kind: string;
  label: string;
  tool: string | null;
  inputs: string | null;
  outcome: { tone: OutcomeTone; text: string | null };
}

function describe(e: Record<string, unknown>): Raw {
  // Browser-agent recorder shape: { at, kind, message, data? }.
  if (typeof e.kind === "string" && typeof e.message === "string") {
    const k = e.kind;
    const tone: OutcomeTone = k === "error" || k === "guard_blocked" ? "error" : k === "paused" || k === "approval" ? "wait" : k === "done" ? "ok" : "neutral";
    return { kind: k, label: e.message, tool: null, inputs: summarizeInputs(e.data), outcome: { tone, text: k === "error" ? e.message : null } };
  }
  const type = str(e.type) ?? str(e.kind) ?? "unknown";
  const { type: _t, at: _a, ...rest } = e;
  void _t;
  void _a;
  switch (type) {
    case "request": {
      const what = str(e.toolName) ?? str(e.lastUserPreview);
      return { kind: type, label: what ? `Model request: ${clip(what)}` : "Model request", tool: null, inputs: summarizeInputs({ tier: e.tier, model: e.model, messages: e.messageCount }), outcome: { tone: "neutral", text: null } };
    }
    case "tool_call": {
      const name = str(e.name) ?? "unknown";
      const ok = typeof e.ok === "boolean" ? e.ok : null;
      return {
        kind: type,
        label: `Tool call: ${name}`,
        tool: name,
        inputs: summarizeInputs(e.input),
        outcome: { tone: ok === false ? "error" : ok === true ? "ok" : "neutral", text: str(e.summary) ?? (ok === false ? "Tool failed" : null) },
      };
    }
    case "model_call": {
      const n = typeof e.call === "number" ? ` ${e.call}` : "";
      return { kind: type, label: `Model call${n}`, tool: null, inputs: null, outcome: { tone: "neutral", text: str(e.stopReason) ? `Stopped: ${e.stopReason}` : null } };
    }
    case "research_done":
      return { kind: type, label: "Research finished", tool: null, inputs: null, outcome: { tone: "ok", text: typeof e.findingsChars === "number" ? `${e.findingsChars} characters of findings` : null } };
    case "result":
      return { kind: type, label: "Result", tool: null, inputs: null, outcome: { tone: "ok", text: summarizeInputs(rest) } };
    case "citations": {
      const n = Array.isArray(e.citations) ? e.citations.length : 0;
      return { kind: type, label: `Citations (${n})`, tool: null, inputs: null, outcome: { tone: "neutral", text: null } };
    }
    case "retry":
      return { kind: type, label: "Retry: output failed validation", tool: null, inputs: null, outcome: { tone: "wait", text: summarizeInputs(e.reason) } };
    case "offline_answer":
      return { kind: type, label: "Offline answer from the tools (no model)", tool: null, inputs: summarizeInputs({ reason: e.reason }), outcome: { tone: "ok", text: summarizeInputs({ tools: e.tools }) } };
    default:
      return { kind: type, label: str(e.message) ?? humanize(type), tool: str(e.name), inputs: summarizeInputs(rest), outcome: { tone: "neutral", text: null } };
  }
}

/** A run that made no model call: scripted drivers, heuristic baselines. */
const noModelRun = (r: RunForSteps): boolean => {
  const mode = isObj(r.input) ? r.input.mode : null;
  return mode === "scripted" || r.model === "scripted" || (r.model ?? "").startsWith("scripted");
};

/** `placedByItself` is false when the step inherited its stage from a neighbour (info lines, unknown kinds). */
function actorOf(raw: Raw, stage: Stage, run: RunForSteps, placedByItself: boolean): Actor {
  if (stage === "approval") return "person";
  const modelBacked = !noModelRun(run);
  if (raw.kind === "tool_call") {
    if (raw.tool === "web_search") return modelBacked ? "model" : "system";
    return stage === "rules" ? "rules" : "tool";
  }
  if (MODEL_KINDS.has(raw.kind)) return modelBacked && raw.kind !== "offline_answer" ? "model" : "system";
  // Only a step that itself reads a rule is the rules engine; a neighbour's info line is not.
  if (stage === "rules" && placedByItself) return "rules";
  // A browser kind counts as the replica browser only on the Execute stage (a seed dry run "extracts" without one).
  if (BROWSER_KINDS.has(raw.kind) && stage === "execute") return run.model === "stagehand" ? "model" : "browser";
  return "system";
}

function tokensOf(e: Record<string, unknown>): { input: number; output: number } | null {
  const u = isObj(e.usage) ? e.usage : null;
  if (!u || typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") return null;
  const cached = (typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0) + (typeof u.cache_creation_input_tokens === "number" ? u.cache_creation_input_tokens : 0);
  return { input: u.input_tokens + cached, output: u.output_tokens };
}

const ms = (v: string | Date | null | undefined): number => (v == null ? NaN : v instanceof Date ? v.getTime() : Date.parse(v));

/**
 * Orders steps: by recorded timestamp when every entry has one (stable, trace position breaks ties), otherwise in
 * trace order, which is the order the recorder appended them.
 */
function order<T extends { index: number; at: string | null }>(steps: T[]): T[] {
  const allTimed = steps.length > 0 && steps.every((s) => Number.isFinite(ms(s.at)));
  if (!allTimed) return steps;
  return [...steps].sort((a, b) => ms(a.at) - ms(b.at) || a.index - b.index);
}

export function traceToSteps(run: RunForSteps): TheaterStep[] {
  const list: unknown[] = Array.isArray(run.trace) ? run.trace : [];
  const agentDefault = AGENT_STAGE[agentKey(run.agent)] ?? "execute";
  const rule = agentKey(run.agent) === "rule_research";

  const draft = list.map((entry, index) => {
    const e = isObj(entry) ? entry : { type: "unknown", value: entry };
    const raw = describe(e);
    const knownKind = KNOWN_KINDS.has(raw.kind);
    let stage: Stage | null = null;
    if (raw.kind === "paused" || raw.kind === "approval") stage = "approval";
    else if (raw.kind === "citations" || raw.kind === "research_done") stage = rule ? "rules" : null;
    else if (raw.kind === "request") stage = agentDefault;
    else if (raw.tool) stage = TOOL_STAGE[raw.tool] ?? matchStage(raw.tool);
    else if (raw.kind === "info") stage = matchStage(raw.label) === "approval" ? "approval" : null;
    else if (raw.kind !== "result") stage = matchStage(raw.label);
    return { e, raw, knownKind, index, stage, at: str(e.at) };
  });

  // Steps with no stage of their own (info lines, results) stay where the run is: the previous step's stage. Leading
  // ones take the first stage the run reaches, or the agent's home stage when nothing places it.
  let prev: Stage = draft.find((d) => d.stage)?.stage ?? agentDefault;
  const placed = draft.map((d) => {
    const stage: Stage = d.stage ?? prev;
    prev = stage;
    return { ...d, stage, placedByItself: d.stage !== null };
  });

  const ordered = order(placed);
  const start = ms(run.startedAt);
  const end = ms(run.finishedAt);
  return ordered.map((d, i): TheaterStep => {
    const at = d.at;
    const t = ms(at);
    const next = ordered[i + 1];
    const nextT = next ? ms(next.at) : end;
    const actor = actorOf(d.raw, d.stage, run, d.placedByItself);
    const target = d.stage === "rules" && d.placedByItself ? ruleTarget(d.e, d.raw.label) : { state: null, version: null };
    const citations = citationsOf(d.e);
    const unverified = /unverified/i.test(d.raw.label) || (isObj(d.e.data) && d.e.data.verified === false) || (rule && (d.raw.kind === "citations" || d.raw.kind === "result"));
    const gateWait = d.stage === "approval" && d.raw.outcome.tone !== "error";
    return {
      index: d.index,
      kind: d.raw.kind,
      knownKind: d.knownKind,
      label: d.knownKind ? d.raw.label : d.raw.label === humanize(d.raw.kind) ? `Unrecognized step: ${d.raw.kind}` : d.raw.label,
      tool: d.raw.tool,
      stage: d.stage,
      actor,
      inputs: d.raw.inputs,
      outcome: gateWait ? { tone: "wait", text: d.raw.outcome.text ?? "Waiting on a person" } : d.raw.outcome,
      citations,
      unverified,
      ruleState: target.state,
      ruleVersion: target.version,
      ruleRef: null,
      at,
      offsetMs: Number.isFinite(t) && Number.isFinite(start) ? Math.max(0, t - start) : null,
      durationMs: Number.isFinite(t) && Number.isFinite(nextT) ? Math.max(0, nextT - t) : null,
      model: actor === "model" ? run.model : null,
      tokens: tokensOf(d.e),
    };
  });
}

/** Per-stage tallies for the static diagram and node badges. */
export function stageCounts(steps: readonly TheaterStep[]): Record<Stage, { total: number; model: number; rules: number }> {
  const out = Object.fromEntries(STAGES.map((s) => [s, { total: 0, model: 0, rules: 0 }])) as Record<Stage, { total: number; model: number; rules: number }>;
  for (const s of steps) {
    const c = out[s.stage];
    c.total += 1;
    if (s.actor === "model") c.model += 1;
    if (s.actor === "rules") c.rules += 1;
  }
  return out;
}
