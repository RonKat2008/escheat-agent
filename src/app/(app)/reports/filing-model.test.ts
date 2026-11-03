import { describe, expect, it } from "vitest";
import { filingStages, pickState } from "./filing-model";

const states = (r: ReturnType<typeof filingStages>) => r.map((s) => `${s.id}:${s.state}`);

describe("filingStages", () => {
  it("before a report exists only Generate can be waiting", () => {
    expect(states(filingStages(null, 0, 3))).toEqual(["generate:waiting", "validate:idle", "approve:idle", "file:idle", "confirmed:idle"]);
    expect(filingStages(null, 0, 0)[0]!.state).toBe("idle");
  });

  it("validation errors stop the path at Validate in pink", () => {
    const s = filingStages({ status: "draft", replicaConfirmation: null }, 2);
    expect(s[1]).toMatchObject({ state: "human", error: true, note: "2 errors to fix" });
    expect(s[2]!.state).toBe("idle");
  });

  it("a validated report waits on the filing agent, then on a person", () => {
    expect(states(filingStages({ status: "validated", replicaConfirmation: null }, 0))).toEqual([
      "generate:done",
      "validate:done",
      "approve:waiting",
      "file:waiting",
      "confirmed:idle",
    ]);
    const paused = filingStages({ status: "awaiting_approval", replicaConfirmation: null }, 0);
    expect(paused[2]).toMatchObject({ state: "human", note: "Needs your approval", error: false });
  });

  it("approved is filing, submitted waits for the number, confirmed is done", () => {
    expect(filingStages({ status: "approved", replicaConfirmation: null }, 0)[3]!.state).toBe("active");
    expect(filingStages({ status: "submitted", replicaConfirmation: null }, 0)[4]!.state).toBe("active");
    const done = filingStages({ status: "submitted", replicaConfirmation: "TX-123" }, 0);
    expect(done.every((s) => s.state === "done")).toBe(true);
    expect(done[4]!.note).toBe("#TX-123");
  });

  it("a failed filing is a pink error on File", () => {
    expect(filingStages({ status: "failed", replicaConfirmation: null }, 0)[3]).toMatchObject({ state: "human", error: true });
  });
});

describe("pickState", () => {
  const list = [
    { state: "CA", hasReport: false, toReportCount: 0, status: null },
    { state: "DE", hasReport: true, toReportCount: 2, status: "validated" },
    { state: "TX", hasReport: true, toReportCount: 0, status: "approved" },
  ];
  it("honors ?state, case-insensitively", () => {
    expect(pickState(list, "tx", null)).toEqual({ state: "TX", filterMatched: null });
  });
  it("?filter=approved opens the state with an approved report waiting to be filed", () => {
    expect(pickState(list, null, "approved")).toEqual({ state: "TX", filterMatched: true });
    expect(pickState(list, "DE", "approved")).toEqual({ state: "DE", filterMatched: false });
  });
  it("says when nothing matches the filter and falls back to the first state with work", () => {
    expect(pickState(list.slice(0, 2), null, "approved")).toEqual({ state: "DE", filterMatched: false });
    expect(pickState(list, "ZZ", null)).toEqual({ state: "DE", filterMatched: null });
  });
});
