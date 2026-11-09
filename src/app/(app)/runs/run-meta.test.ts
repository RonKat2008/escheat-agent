import { describe, expect, it } from "vitest";
import { agentLabel, costCell, isCardRun, gateHref, isReplay, isSkippedReplay, runTask } from "./run-meta";

describe("R4-12 replay and task labelling", () => {
  it("treats a cancelled offline replay as a replay, not a cancellation", () => {
    expect(isSkippedReplay("cancelled", { mode: "replay" })).toBe(true);
    expect(isSkippedReplay("cancelled", { mode: "scripted" })).toBe(false);
    expect(isSkippedReplay("failed", { mode: "replay" })).toBe(false);
    expect(isSkippedReplay("succeeded", { mode: "replay" })).toBe(false);
  });
  it("names hyphenated agents and fills the letter-writer task with the check number", () => {
    expect(agentLabel("letter-writer")).toBe("Letter writer");
    const input = { mode: "replay", request: { lastUserPreview: '{"item":{"kind":"vendor_check","number":"10087","payee_name":"X"}}' } };
    expect(runTask("letter-writer", input)).toBe("Compose letter for #10087");
    expect(runTask("classifier", input)).toBe("Classify #10087");
    expect(runTask("filing_agent", { mode: "scripted", dryRun: true })).toBe("Filing readiness dry run (nothing filed)");
    expect(runTask("letter-writer", {})).toBe("Draft a due-diligence letter");
  });
});

describe("R5-22: one rule for cost and task cells", () => {
  it("runs that made no model call read Not billed, whatever they stored", () => {
    expect(costCell({ input: { mode: "scripted" }, model: null, costUsdMicros: 0 }).kind).toBe("not_billed");
    expect(costCell({ input: {}, model: "scripted", costUsdMicros: 0 }).kind).toBe("not_billed");
    expect(costCell({ input: { mode: "replay" }, model: "claude", costUsdMicros: 0 }).kind).toBe("not_billed");
  });
  it("R11-03: a card run (no model) reads Not billed and is recognised", () => {
    expect(isCardRun({ mode: "card" })).toBe(true);
    expect(isCardRun({ mode: "replay" })).toBe(false);
    expect(isCardRun(null)).toBe(false);
    const c = costCell({ input: { mode: "card" }, model: null, costUsdMicros: 0 });
    expect(c.kind).toBe("not_billed");
    expect(c.title).toMatch(/no model/i);
  });
  it("model runs show their cost; missing cost is unknown, never $0", () => {
    expect(costCell({ input: {}, model: "claude", costUsdMicros: 1234 }, 10)).toMatchObject({ kind: "cost", micros: 1234, title: "10 tokens" });
    expect(costCell({ input: {}, model: "claude", costUsdMicros: null }).kind).toBe("unknown");
  });
  it("chat runs name the question they answered", () => {
    expect(runTask("chat", { request: { lastUserPreview: "What do we owe and where?" } })).toBe("Answer “What do we owe and where?”");
    expect(runTask("chat", { mode: "replay", request: { lastUserPreview: "x".repeat(200) } })!.length).toBeLessThan(95);
    expect(runTask("chat", {})).toBe("Answer a chat question");
  });
});

describe("gateHref", () => {
  it("sends a paused filing run to the report gate for its state", () => {
    expect(gateHref("filing_agent", { reportId: "r1", state: "TX" }, null)).toEqual({ href: "/reports?state=TX", label: "Review on Reports" });
    expect(gateHref("filing_agent", { reportId: "r1" }, "ca")).toEqual({ href: "/reports?state=CA", label: "Review on Reports" });
  });
  it("sends claim runs to Recoveries and anything else to Approvals", () => {
    expect(gateHref("claim_agent", { recoveryId: "x" }, null)).toEqual({ href: "/recoveries", label: "Review on Recoveries" });
    expect(gateHref("letter_writer", {}, null)).toEqual({ href: "/approvals", label: "Review in Approvals" });
  });
  it("falls back to /reports when a filing run has no known state", () => {
    expect(gateHref("filing_agent", {}, null).href).toBe("/reports");
  });
});

describe("isReplay", () => {
  it("is true only for runs logged with mode replay", () => {
    expect(isReplay({ mode: "replay", request: {} })).toBe(true);
    expect(isReplay({ mode: "scripted" })).toBe(false);
    expect(isReplay(null)).toBe(false);
  });
});

describe("R8-12 run duration is never negative", () => {
  it("clamps clock skew to 0 and passes real durations through", async () => {
    const { runDurationMs } = await import("./run-meta");
    const t = new Date("2026-11-04T10:00:00.000Z");
    expect(runDurationMs(t, new Date(t.getTime() - 3))).toBe(0);
    expect(runDurationMs(t, new Date(t.getTime() + 1500))).toBe(1500);
    expect(runDurationMs(t, null)).toBeNull();
  });
});

describe("R8-19 hidden-runs toggle names what it reveals", () => {
  it("heuristic-only hidden rows say heuristic classifications", async () => {
    const { hiddenRunsCopy } = await import("./run-meta");
    const c = hiddenRunsCopy(5, 0);
    expect(c.showLabel).toBe("Show heuristic classifications");
    expect(c.breakdown).toBeNull();
    expect(hiddenRunsCopy(1, 0).noun).toBe("heuristic classification");
  });
  it("mixed rows say offline runs and break the count down to match the chips", async () => {
    const { hiddenRunsCopy } = await import("./run-meta");
    const c = hiddenRunsCopy(5, 2);
    expect(c.showLabel).toBe("Show offline runs");
    expect(c.breakdown).toBe("5 heuristic, 2 replayed");
    expect(hiddenRunsCopy(0, 3).breakdown).toBeNull();
  });
});
