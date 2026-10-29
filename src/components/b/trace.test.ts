import { describe, expect, it } from "vitest";
import { collectCitations, formatCostMicros, formatDuration, normalizeTrace, safeHttpUrl } from "./trace";

describe("normalizeTrace", () => {
  it("handles browser-agent steps and computes durations from timestamps", () => {
    const steps = normalizeTrace(
      [
        { at: "2026-11-01T10:00:00.000Z", kind: "info", message: "Opened portal" },
        { at: "2026-11-01T10:00:01.500Z", kind: "paused", message: "Waiting for approval" },
      ],
      "2026-11-01T10:00:03.000Z",
    );
    expect(steps.map((s) => s.label)).toEqual(["Opened portal", "Waiting for approval"]);
    expect(steps[0]!.durationMs).toBe(1500);
    expect(steps[1]!.durationMs).toBe(1500);
    expect(steps[1]!.tone).toBe("warn");
  });

  it("handles LLM trace entries", () => {
    const steps = normalizeTrace([{ type: "request", model: "m" }, { type: "tool_call", name: "web_search", input: { q: "x" } }, { type: "result", elapsedMs: 5 }], null);
    expect(steps.map((s) => s.label)).toEqual(["Request", "Tool call: web_search", "Result"]);
    expect(steps[1]!.data).toEqual({ q: "x" });
    expect(steps[0]!.durationMs).toBeNull();
  });

  it("tolerates null and junk", () => {
    expect(normalizeTrace(null, null)).toEqual([]);
    expect(normalizeTrace([1, "a", null], null)).toEqual([]);
  });
});

describe("helpers", () => {
  it("formats durations and costs", () => {
    expect(formatDuration(420)).toBe("420ms");
    expect(formatDuration(42_000)).toBe("42.0s");
    expect(formatDuration(null)).toBe("");
    expect(formatCostMicros(31_000)).toBe("$0.03");
    expect(formatCostMicros(900)).toBe("$0.0009");
    expect(formatCostMicros(null)).toBe("Unknown");
  });
  it("only allows http(s) urls and dedupes citations", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("https://example.gov/a")).toBe("https://example.gov/a");
    const c = collectCitations([{ type: "citations", citations: [{ url: "https://a.gov/x", title: "A" }, { url: "javascript:x" }] }], { citations: [{ url: "https://a.gov/x" }] });
    expect(c).toHaveLength(1);
  });
});
