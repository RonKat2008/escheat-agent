import { describe, expect, it } from "vitest";
import { traceToSteps } from "@/lib/theater/steps";
import { withRuleRefs } from "./theater";

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
