import { describe, expect, it } from "vitest";
import { followCursor, holdMs, isWaitingAtGate, STEP_MS } from "./playback";
import { stageCounts, summarizeInputs, traceToSteps, type RunForSteps } from "./steps";

const run = (trace: unknown, over: Partial<RunForSteps> = {}): RunForSteps => ({
  agent: "chat",
  model: "claude-sonnet-x",
  input: {},
  trace,
  startedAt: "2026-11-01T10:00:00.000Z",
  finishedAt: "2026-11-01T10:00:10.000Z",
  ...over,
});

describe("traceToSteps", () => {
  it("returns no steps for an empty, null or non-array trace", () => {
    expect(traceToSteps(run([]))).toEqual([]);
    expect(traceToSteps(run(null))).toEqual([]);
    expect(traceToSteps(run({ not: "an array" }))).toEqual([]);
  });

  it("turns every trace entry into exactly one step, even non-objects", () => {
    const trace = [{ type: "request", toolName: "classify" }, "stray string", 42, { type: "result" }];
    const steps = traceToSteps(run(trace));
    expect(steps).toHaveLength(trace.length);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("keeps an unknown tool kind, labelled honestly, placed where the run is", () => {
    const steps = traceToSteps(run([{ type: "request" }, { type: "tool_call", name: "list_rules", input: { state: "TX" } }, { type: "teleport", target: "mars" }]));
    const odd = steps[2]!;
    expect(odd.knownKind).toBe(false);
    expect(odd.kind).toBe("teleport");
    expect(odd.label).toBe("Unrecognized step: teleport");
    expect(odd.stage).toBe("rules"); // inherits the previous step's stage, never a guessed one
    expect(odd.inputs).toBe("target: mars");
    expect(odd.actor).toBe("system"); // inherited placement never makes it a rules-engine step
  });

  it("keeps trace order when timestamps are missing", () => {
    const steps = traceToSteps(run([{ type: "request" }, { type: "tool_call", name: "get_exposure" }, { type: "result" }]));
    expect(steps.map((s) => s.kind)).toEqual(["request", "tool_call", "result"]);
  });

  it("orders by recorded timestamp when every step has one (trace position breaks ties)", () => {
    const trace = [
      { at: "2026-11-01T10:00:03.000Z", kind: "extract", message: "TX: 4 stale items detected" },
      { at: "2026-11-01T10:00:01.000Z", kind: "info", message: "first" },
      { at: "2026-11-01T10:00:03.000Z", kind: "extract", message: "CA: 2 stale items detected" },
    ];
    const steps = traceToSteps(run(trace, { agent: "filing_agent", model: "scripted", input: { mode: "scripted" } }));
    expect(steps.map((s) => s.index)).toEqual([1, 0, 2]);
    expect(steps[0]!.offsetMs).toBe(1000);
    expect(steps[0]!.durationMs).toBe(2000);
    expect(steps[2]!.durationMs).toBe(7000); // until the run finished
  });

  it("maps the seed's scripted filing dry run onto the pipeline and parks it at the gate", () => {
    const at = "2026-11-01T10:00:01.000Z";
    const steps = traceToSteps(
      run(
        [
          { at, kind: "info", message: "SCRIPTED (no model) - deterministic filing readiness check run by the demo seed" },
          { at, kind: "extract", message: "Loaded CA rules @ 2026.10.0-draft (UNVERIFIED values present)" },
          { at, kind: "extract", message: "CA: 12 stale items detected" },
          { at, kind: "info", message: "Total 12 items, $1,000.00" },
          { at, kind: "done", message: "Dry run only: no portal opened, no report generated, nothing filed. Filing needs a person's approval." },
        ],
        { agent: "filing_agent", model: "scripted", input: { mode: "scripted" } },
      ),
    );
    expect(steps.map((s) => s.stage)).toEqual(["rules", "rules", "reconcile", "reconcile", "approval"]);
    expect(steps[0]!.actor).toBe("system"); // the leading info line sits on the rules node but is not a rule lookup
    const rule = steps[1]!;
    expect(rule.actor).toBe("rules");
    expect(rule.unverified).toBe(true);
    expect(rule.ruleState).toBe("CA");
    expect(rule.ruleVersion).toBe("2026.10.0-draft");
    expect(steps[4]!.actor).toBe("person");
    expect(steps[4]!.outcome.tone).toBe("wait");
    expect(steps.some((s) => s.actor === "model")).toBe(false); // scripted: no model step
    expect(steps[2]!.actor).toBe("system"); // a dry-run count, no browser was opened
    expect(isWaitingAtGate(steps, 4)).toBe(true);
  });

  it("marks model steps blue (actor model) and deterministic rule tools as the rules engine", () => {
    const steps = traceToSteps(
      run([
        { type: "request", lastUserPreview: "What do we owe?", model: "m" },
        { type: "tool_call", name: "list_rules", input: { state: "tx" }, ok: true, summary: "3 rule files" },
        { type: "tool_call", name: "get_exposure", input: {}, ok: true, summary: "$12k" },
        { type: "tool_call", name: "create_outreach_draft", ok: false, summary: "blocked" },
        { type: "result", textChars: 120 },
      ]),
    );
    expect(steps.map((s) => s.actor)).toEqual(["model", "rules", "tool", "tool", "model"]);
    expect(steps.map((s) => s.stage)).toEqual(["ingest", "rules", "reconcile", "draft", "draft"]);
    expect(steps[1]!.ruleState).toBe("TX");
    expect(steps[1]!.tool).toBe("list_rules");
    expect(steps[1]!.outcome).toEqual({ tone: "ok", text: "3 rule files" });
    expect(steps[3]!.outcome.tone).toBe("error");
    expect(steps[0]!.model).toBe("claude-sonnet-x");
    expect(steps[1]!.model).toBeNull();
  });

  it("rule research: citations are kept with their urls, unsafe ones dropped, and flagged UNVERIFIED", () => {
    const steps = traceToSteps(
      run(
        [
          { type: "request", toolName: "propose_rule" },
          { type: "tool_call", name: "web_search", input: { query: "TX dormancy" } },
          { type: "research_done", findingsChars: 900 },
          { type: "citations", citations: [{ url: "https://comptroller.texas.gov/x", title: "TX" }, { url: "javascript:alert(1)" }] },
        ],
        { agent: "rule-research" },
      ),
    );
    expect(steps.every((s) => s.stage === "rules")).toBe(true);
    expect(steps[1]!.actor).toBe("model");
    expect(steps[3]!.citations).toEqual([{ url: "https://comptroller.texas.gov/x", title: "TX" }]);
    expect(steps[3]!.unverified).toBe(true);
  });

  it("puts paused/approval steps on the gate", () => {
    const steps = traceToSteps(run([{ kind: "navigate", message: "Open replica portal" }, { kind: "paused", message: "Waiting at Approve" }], { agent: "filing_agent", model: "scripted" }));
    expect(steps.map((s) => [s.stage, s.actor])).toEqual([
      ["execute", "browser"],
      ["approval", "person"],
    ]);
  });
});

describe("model_call (chat)", () => {
  it("is a model step carrying the tokens it recorded", () => {
    const [s] = traceToSteps(run([{ type: "model_call", call: 1, stopReason: "tool_use", usage: { input_tokens: 84, output_tokens: 28, cache_read_input_tokens: 16 } }]));
    expect(s!.knownKind).toBe(true);
    expect(s!.label).toBe("Model call 1");
    expect(s!.actor).toBe("model");
    expect(s!.tokens).toEqual({ input: 100, output: 28 });
    expect(s!.outcome.text).toBe("Stopped: tool_use");
  });
});

describe("stageCounts", () => {
  it("tallies totals, model and rules-engine steps per stage", () => {
    const steps = traceToSteps(run([{ type: "request" }, { type: "tool_call", name: "list_rules" }, { type: "tool_call", name: "upcoming_deadlines" }]));
    const c = stageCounts(steps);
    expect(c.rules).toEqual({ total: 2, model: 0, rules: 2 });
    expect(c.ingest).toEqual({ total: 1, model: 1, rules: 0 });
    expect(c.approval.total).toBe(0);
  });
});

describe("summarizeInputs", () => {
  it("skips empty values and clips long text", () => {
    expect(summarizeInputs({ a: 1, b: null, c: "", d: "x" })).toBe("a: 1, d: x");
    expect(summarizeInputs(null)).toBeNull();
    expect(summarizeInputs({ long: "y".repeat(300) })!.length).toBeLessThanOrEqual(140);
  });
});

describe("playback", () => {
  it("holds the gate twice as long and scales with speed", () => {
    const [gate] = traceToSteps(run([{ kind: "approval", message: "Approve" }]));
    expect(holdMs(undefined, 1)).toBe(STEP_MS);
    expect(holdMs(gate, 1)).toBe(STEP_MS * 2);
    expect(holdMs(undefined, 4)).toBe(STEP_MS / 4);
  });

  it("follows a live run only when the viewer is on the latest step", () => {
    expect(followCursor(2, 3, 5)).toBe(4);
    expect(followCursor(0, 3, 5)).toBe(0);
    expect(followCursor(0, 0, 2)).toBe(1);
    expect(followCursor(0, 0, 0)).toBe(0);
  });
});

describe("R9-05 classification and stage counts", () => {
  const at = "2026-11-01T10:00:01.000Z";
  const filing = [
    { at, kind: "info", message: "Starting TX filing" },
    { at, kind: "navigate", message: "Opened the replica portal login" },
    { at, kind: "action", message: "Entered holder credentials" },
    { at, kind: "screenshot", message: "Captured the upload page" },
    { at, kind: "action", message: "Uploaded the report file" },
    { at, kind: "paused", message: "Awaiting a person's approval to submit" },
    { at, kind: "approval", message: "Approved by Dana" },
    { at, kind: "done", message: "Report r1 submitted to the replica portal: CONF-1. 1 stale item marked reported." },
  ];
  const steps = traceToSteps(run(filing, { agent: "filing_agent", model: "stagehand", input: {} }));

  it("classifies the final submission as Execute, never Draft", () => {
    const last = steps[steps.length - 1]!;
    expect(last.stage).toBe("execute");
    expect(last.stage).not.toBe("draft");
  });

  it("puts browser actions on Execute and approvals on the gate", () => {
    expect(steps.filter((s) => s.stage === "execute").length).toBeGreaterThanOrEqual(5);
    expect(steps.filter((s) => s.stage === "approval")).toHaveLength(2);
  });

  it("derives stage counts from the same classified steps as the log", () => {
    const counts = stageCounts(steps);
    expect(Object.values(counts).reduce((n, c) => n + c.total, 0)).toBe(steps.length);
    for (const stage of Object.keys(counts) as Array<keyof typeof counts>) expect(counts[stage].total).toBe(steps.filter((s) => s.stage === stage).length);
    expect(counts.approval.total).toBe(2);
  });
});
