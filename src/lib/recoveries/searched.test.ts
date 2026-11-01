import { describe, expect, it } from "vitest";
import { lastSearchedByState, type SearchRun } from "./searched";

const run = (startedAt: string, trace: unknown[], input: unknown = { states: ["CA", "DE", "TX"] }): SearchRun => ({
  startedAt: new Date(startedAt),
  input: input as Record<string, unknown>,
  trace,
});

describe("lastSearchedByState", () => {
  it("reads each state's last search from the run's per-state steps, even when the state found nothing", () => {
    const r = run("2026-11-01T10:00:00Z", [
      { at: "2026-11-01T10:00:05Z", kind: "extract", message: 'CA: searched "Northwind" -> 0 result row(s)', data: { state: "CA", variant: "Northwind", rows: 0 } },
      { at: "2026-11-01T10:00:09Z", kind: "info", message: "DE: no match at or above 80% confidence." },
      { at: "2026-11-01T10:00:12Z", kind: "extract", message: "TX: searched", data: { state: "TX", rows: 2 } },
    ]);
    const out = lastSearchedByState([r], ["CA", "DE", "TX"]);
    expect(out.CA).toBe("2026-11-01T10:00:05.000Z");
    expect(out.DE).toBe("2026-11-01T10:00:09.000Z");
    expect(out.TX).toBe("2026-11-01T10:00:12.000Z");
  });

  it("a state the run never reached stays null (never claimed as searched)", () => {
    const r = run("2026-11-01T10:00:00Z", [{ at: "2026-11-01T10:00:05Z", kind: "extract", message: "CA: x", data: { state: "CA" } }], { states: ["CA"] });
    expect(lastSearchedByState([r], ["CA", "DE"])).toEqual({ CA: "2026-11-01T10:00:05.000Z", DE: null });
  });

  it("uses the newest run that covered the state", () => {
    const older = run("2026-10-01T10:00:00Z", [{ at: "2026-10-01T10:00:01Z", kind: "info", message: "DE: no match" }]);
    const newer = run("2026-11-01T10:00:00Z", [{ at: "2026-11-01T10:00:01Z", kind: "info", message: "CA: no match" }]);
    const out = lastSearchedByState([newer, older], ["CA", "DE"]);
    expect(out.CA).toBe("2026-11-01T10:00:01.000Z");
    expect(out.DE).toBe("2026-10-01T10:00:01.000Z");
  });

  it("falls back to the run start when a step has no timestamp", () => {
    const r = run("2026-11-01T10:00:00Z", [{ kind: "info", message: "DE: no match" }]);
    expect(lastSearchedByState([r], ["DE"]).DE).toBe("2026-11-01T10:00:00.000Z");
  });
});
