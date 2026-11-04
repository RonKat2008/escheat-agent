
import { describe, expect, it } from "vitest";
import { groupPickerRuns, tokenProvenance } from "./playback";

describe("tokenProvenance", () => {
  it("labels replayed and scripted tokens as recorded, and leaves live model runs unlabeled", () => {
    expect(tokenProvenance({ replay: true, noModel: true })).toBe("recorded, not spent");
    expect(tokenProvenance({ replay: false, noModel: true })).toBe("recorded; no model call");
    expect(tokenProvenance({ replay: false, noModel: false })).toBeNull();
  });
});

describe("groupPickerRuns", () => {
  const r = (id: string, agent: string, kind: "filing" | "recovery" | "other") => ({ id, agent, kind, label: agent, startedAt: "2026-11-01T00:00:00Z" });
  it("puts filing then recovery first and keeps newest-first inside a group", () => {
    const groups = groupPickerRuns([r("1", "chat", "other"), r("2", "chat", "other"), r("3", "recovery_agent", "recovery"), r("4", "filing_agent", "filing")]);
    expect(groups.map((g) => g.key)).toEqual(["filing_agent", "recovery_agent", "chat"]);
    expect(groups[2]!.runs.map((x) => x.id)).toEqual(["1", "2"]);
  });
});
