import { describe, expect, it } from "vitest";
import { agentLabel, gateHref, isReplay, isSkippedReplay, runTask } from "./run-meta";

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
    expect(runTask("letter-writer", {})).toBe("Draft a due-diligence letter");
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
