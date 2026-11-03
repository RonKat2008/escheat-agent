import { describe, expect, it } from "vitest";
import { CLOSE_OUT_PROMPTS, EXAMPLE_PROMPTS, followUpsFor } from "@/components/chat/followups";
import type { UiPayload } from "./ui-types";
import { hasRecordedAnswer, RECORDED_CHAT_GROUPS, recordedNextPrompts, recordedOnly } from "./recorded-prompts";

const exposure = {
  kind: "exposure",
  props: {
    state: null,
    exposure: {
      asOf: "2026-11-01",
      itemCount: 3,
      anyUnverified: true,
      total: { cents: 600, formatted: "$6.00" },
      byState: [{ state: "CA", cents: 500, formatted: "$5.00", count: 2, anyUnverified: true }],
    },
  },
} as unknown as UiPayload;

describe("recorded prompts", () => {
  it("a new chat can start with every single and every conversation opener", () => {
    const first = recordedNextPrompts([]);
    expect(first).toContain("What do we owe in unclaimed property, and where?");
    expect(first).toContain("What do we owe and where?");
    expect(first).toContain("Close out Texas for this cycle");
    expect(new Set(first).size).toBe(first.length);
  });

  it("after a conversation opener only its recorded next turn replays", () => {
    expect(recordedNextPrompts(["What do we owe and where?"])).toEqual(["Explain check #10087"]);
    expect(recordedNextPrompts(["What do we owe and where?", "Explain check #10087"])).toEqual(["Draft the due-diligence letter for #10087"]);
    expect(recordedNextPrompts(["What do we owe and where?", "Explain check #10087", "Draft the due-diligence letter for #10087"])).toEqual([]);
  });

  it("a single has no recorded follow-up", () => {
    expect(recordedNextPrompts(["What do we owe in unclaimed property, and where?"])).toEqual([]);
    expect(hasRecordedAnswer(["Generate the CA report"], "Which rules are unverified?")).toBe(false);
  });

  it("matching ignores case and surrounding space", () => {
    expect(hasRecordedAnswer([" what do we owe and where? "], "explain check #10087")).toBe(true);
  });

  it("recordedOnly keeps recorded suggestions, tops up with recorded next turns and caps", () => {
    expect(recordedOnly(["Show the open CA items", "What's waiting for approval?"], ["What do we owe and where?"], 3)).toEqual(["Explain check #10087"]);
    expect(recordedOnly([], [], 2)).toHaveLength(2);
    expect(recordedOnly(["Explain check #10482"], [], 3)[0]).toBe("Explain check #10482");
  });

  it("every empty-state chip has a recording as a first turn", () => {
    for (const q of [...EXAMPLE_PROMPTS, ...CLOSE_OUT_PROMPTS.map((p) => p.prompt)]) expect(hasRecordedAnswer([], q), q).toBe(true);
  });

  it("groups keep the strings the cassettes were recorded with", () => {
    expect(Object.keys(RECORDED_CHAT_GROUPS)).toEqual(["reads", "demo", "draft", "early", "report", "closeout"]);
  });
});

describe("followUpsFor offline (F36)", () => {
  it("drops unrecorded chips such as 'Show the open CA items' and offers the recorded next turn", () => {
    const online = followUpsFor([exposure], ["What do we owe and where?"]);
    expect(online).toContain("Show the open CA items");
    const offline = followUpsFor([exposure], ["What do we owe and where?"], { offline: true });
    expect(offline).toEqual(["Explain check #10087"]);
  });

  it("the chat that refuses an early draft is itself a recorded first turn", () => {
    expect(hasRecordedAnswer([], "Draft the due-diligence letter for #10482")).toBe(true);
  });

  it("offers no continuation after a recorded single (no follow-up was recorded)", () => {
    expect(followUpsFor([exposure], ["What do we owe in unclaimed property, and where?"], { offline: true })).toEqual([]);
  });
});
