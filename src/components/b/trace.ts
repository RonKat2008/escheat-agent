/** Normalizes the two trace shapes in agent_runs.trace into one step model for the viewer. */
export interface TraceStepView {
  index: number;
  label: string;
  kind: string;
  at: string | null;
  /** Milliseconds until the next step started (or the run finished), when timestamps exist. */
  durationMs: number | null;
  data: unknown;
  screenshot: string | null;
  tone: "neutral" | "ok" | "warn" | "error";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function labelFor(e: Record<string, unknown>): { label: string; kind: string; data: unknown } {
  if (typeof e.message === "string" && typeof e.kind === "string") {
    return { label: e.message, kind: e.kind, data: e.data ?? null };
  }
  const type = typeof e.type === "string" ? e.type : "step";
  const { type: _t, ...rest } = e;
  void _t;
  switch (type) {
    case "request":
      return { label: "Request", kind: type, data: rest };
    case "tool_call":
      return { label: `Tool call: ${String(e.name ?? "unknown")}`, kind: type, data: e.input ?? rest };
    case "research_done":
      return { label: "Research finished", kind: type, data: rest };
    case "result":
      return { label: "Result", kind: type, data: rest };
    case "citations": {
      const n = Array.isArray(e.citations) ? e.citations.length : 0;
      return { label: `Citations (${n})`, kind: type, data: rest };
    }
    case "retry":
      return { label: "Retry: output failed validation", kind: type, data: rest };
    default:
      return { label: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), kind: type, data: rest };
  }
}

const toneOf = (kind: string): TraceStepView["tone"] =>
  kind === "error" || kind === "guard_blocked" ? "error" : kind === "paused" || kind === "approval" || kind === "retry" ? "warn" : kind === "done" || kind === "result" ? "ok" : "neutral";

export function normalizeTrace(trace: unknown, finishedAt: Date | string | null): TraceStepView[] {
  const list = Array.isArray(trace) ? trace.filter(isObj) : [];
  const steps = list.map((e, index): TraceStepView => {
    const { label, kind, data } = labelFor(e);
    return {
      index,
      label,
      kind,
      at: typeof e.at === "string" ? e.at : null,
      durationMs: null,
      data,
      screenshot: typeof e.screenshot === "string" ? e.screenshot : null,
      tone: toneOf(kind),
    };
  });
  const end = finishedAt ? new Date(finishedAt).getTime() : null;
  return steps.map((s, i) => {
    const start = s.at ? Date.parse(s.at) : NaN;
    const nextAt = steps[i + 1]?.at ? Date.parse(steps[i + 1]!.at!) : end;
    const d = Number.isFinite(start) && nextAt != null && Number.isFinite(nextAt) ? Math.max(0, nextAt - start) : null;
    return { ...s, durationMs: d };
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function formatCostMicros(micros: number | null | undefined): string {
  if (micros == null) return "Unknown";
  const usd = micros / 1_000_000;
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export interface CitationView {
  url: string;
  title: string;
  quote?: string;
}

/** Only http(s) links are ever rendered as links. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function collectCitations(trace: unknown, output: unknown): CitationView[] {
  const out = new Map<string, CitationView>();
  const add = (c: unknown) => {
    if (!isObj(c)) return;
    const url = safeHttpUrl(c.url);
    if (!url) return;
    out.set(url, {
      url,
      title: typeof c.title === "string" && c.title ? c.title : new URL(url).hostname,
      quote: typeof c.quote === "string" ? c.quote : typeof c.citedText === "string" ? c.citedText : undefined,
    });
  };
  for (const e of Array.isArray(trace) ? trace : []) {
    if (isObj(e) && e.type === "citations" && Array.isArray(e.citations)) e.citations.forEach(add);
  }
  if (isObj(output) && Array.isArray(output.citations)) output.citations.forEach(add);
  return [...out.values()];
}
