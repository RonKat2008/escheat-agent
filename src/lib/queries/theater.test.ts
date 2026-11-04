import { describe, expect, it } from "vitest";
import { traceToSteps } from "@/lib/theater/steps";
import { pickDemoRun, withRuleRefs } from "./theater";

describe("withRuleRefs", () => {
  it("attaches the versioned rule file (source urls, verified flag) to rules-engine steps only", () => {
    const steps = traceToSteps({
      agent: "chat",
      model: "m",
      input: {},
      trace: [{ type: "request" }, { type: "tool_call", name: "list_rules", input: { state: "CA" } }, { type: "tool_call", name: "list_rules", input: { state: "ZZ" } }],
      startedAt: "2026-11-01T10:00:00Z",
      finishedAt: null,
    });
    const out = withRuleRefs(steps);
    expect(out[0]!.ruleRef).toBeNull();
    const ca = out[1]!.ruleRef!;
    expect(ca.state).toBe("CA");
    expect(ca.sourceUrls.length).toBeGreaterThan(0);
    expect(ca.sourceUrls.every((u) => /^https?:\/\//.test(u))).toBe(true);
    if (!ca.verified) expect(out[1]!.unverified).toBe(true);
    expect(out[2]!.ruleRef).toBeNull(); // no rule file: no reference, never a guess
  });
});

describe("pickDemoRun (R9-05)", () => {
  const r = (id: string, kind: "filing" | "recovery" | "other", stepCount: number) => ({ id, kind, stepCount });
  it("prefers the latest filing run over a newer chat", () => {
    expect(pickDemoRun([r("chat", "other", 3), r("rec", "recovery", 9), r("f2", "filing", 8), r("f1", "filing", 20)])?.id).toBe("f2");
  });
  it("falls back to recovery, then the run with the most steps (newest wins ties)", () => {
    expect(pickDemoRun([r("c", "other", 3), r("rec", "recovery", 5)])?.id).toBe("rec");
    expect(pickDemoRun([r("a", "other", 3), r("b", "other", 12), r("c", "other", 12)])?.id).toBe("b");
  });
  it("skips empty runs unless nothing else exists, and returns null for none", () => {
    expect(pickDemoRun([r("empty", "filing", 0), r("chat", "other", 2)])?.id).toBe("chat");
    expect(pickDemoRun([r("empty", "filing", 0)])?.id).toBe("empty");
    expect(pickDemoRun([])).toBeNull();
  });
});
