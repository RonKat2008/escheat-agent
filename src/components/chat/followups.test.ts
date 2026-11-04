import { describe, expect, it } from "vitest";
import type { UiPayload } from "@/lib/chat/ui-types";
import { answerableOffline } from "@/lib/chat/offline-intent";
import { hasRecordedAnswer } from "@/lib/chat/recorded-prompts";
import { CLOSE_OUT_PROMPTS, closeOutPrompt, EXAMPLE_PROMPTS, followUpsFor, offlineRecovery } from "./followups";

const exposure = {
  kind: "exposure",
  props: {
    state: null,
    exposure: {
      asOf: "2026-11-01",
      itemCount: 3,
      anyUnverified: true,
      total: { cents: 600, formatted: "$6.00" },
      byState: [
        { state: "TX", cents: 100, formatted: "$1.00", count: 1, anyUnverified: true },
        { state: "CA", cents: 500, formatted: "$5.00", count: 2, anyUnverified: true },
      ],
    },
  },
} as unknown as UiPayload;

describe("follow-up chips", () => {
  it("derive from the views shown, largest state first, capped at three", () => {
    const chips = followUpsFor([exposure], ["What do we owe and where?"]);
    expect(chips).toEqual(["Show the open CA items", "What's due in the next 90 days?", "Which rules are unverified?"]);
  });

  it("skip questions already asked and fall back to examples", () => {
    const chips = followUpsFor([], [EXAMPLE_PROMPTS[0]]);
    expect(chips).not.toContain(EXAMPLE_PROMPTS[0]);
    expect(chips).toHaveLength(3);
  });

  it("a close-out plan suggests what's left for its state; a generated report suggests closing that state out", () => {
    const plan = { kind: "close_plan", props: { plan: { state: "TX", done: 3, total: 8 } } } as unknown as UiPayload;
    expect(followUpsFor([plan], [])).toEqual(["What's left to close out TX?", "What's waiting for approval?"]);
    const closed = { kind: "close_plan", props: { plan: { state: "TX", done: 8, total: 8 } } } as unknown as UiPayload;
    expect(followUpsFor([closed], [])).toEqual(["What's waiting for approval?"]);
    const report = { kind: "report", props: { state: "DE" } } as unknown as UiPayload;
    expect(followUpsFor([report], [])[0]).toBe(closeOutPrompt("DE"));
    expect(closeOutPrompt("de")).toBe("Close out Delaware for this cycle");
    expect(CLOSE_OUT_PROMPTS.map((p) => p.state)).toEqual(["CA", "DE", "TX"]);
  });

  it("never suggest approving, sending or filing", () => {
    const card = { kind: "approval_card", props: { checkNumber: "10482" } } as unknown as UiPayload;
    const all = [...followUpsFor([card], []), ...followUpsFor([exposure], [])];
    for (const q of all) expect(q).not.toMatch(/\b(approve|send|file|mail)\b/i);
  });
});

describe("offline recovery chips (R4-26)", () => {
  it("offers only prompts that replay as the first turn of a new chat", () => {
    const { prompts } = offlineRecovery(["How much interest do we owe Texas?"], true);
    expect(prompts.length).toBeGreaterThan(0);
    for (const q of prompts) expect(hasRecordedAnswer([], q)).toBe(true);
  });

  it("after a real recorded answer it says the conversation ended, and never re-offers what was asked (R5-16)", () => {
    const asked = ["Draft the due-diligence letter for #10087"];
    const r = offlineRecovery(asked, false);
    expect(r.note).toMatch(/end of this recorded conversation/);
    expect(r.note).not.toMatch(/only answers recorded questions/);
    expect(r.prompts.map((p) => p.toLowerCase())).not.toContain(asked[0]!.toLowerCase());
  });

  it("never offers two wordings of the same exposure question", () => {
    const { prompts } = offlineRecovery(["Something off-script"], true);
    const owe = prompts.filter((p) => /what do we owe/i.test(p));
    expect(owe.length).toBeLessThanOrEqual(1);
  });

  it("a recorded first question asked later in a chat is offered first, as a new chat (R5-16)", () => {
    const asked = ["Explain check #10087", "What do we owe and where?"];
    const r = offlineRecovery(asked, true);
    expect(r.prompts[0]).toBe("What do we owe and where?");
    expect(r.note).toMatch(/first question of a new chat/);
  });

  it("offline follow-ups after the recorded demo only name prompts offline chat can answer (recorded, or directly from the data)", () => {
    const demo = ["What do we owe and where?", "Explain check #10087"];
    const chips = followUpsFor([exposure], demo, { offline: true });
    expect(chips.length).toBeGreaterThan(0);
    for (const q of chips) expect(hasRecordedAnswer(demo, q) || answerableOffline(q)).toBe(true);
  });

  it("after a direct offline answer, the recovery note says so (R6-03)", () => {
    const r = offlineRecovery(["What do we still owe?"], false, { direct: true });
    expect(r.note).toMatch(/Answered from your data/);
    expect(r.prompts).not.toContain("What do we still owe?");
  });

  it("an unknown question's note explains what offline chat can answer", () => {
    expect(offlineRecovery(["Write me a poem"], true).note).toMatch(/directly from your data\. This one is neither/);
  });

  it("the starter prompts all have recordings", () => {
    for (const q of EXAMPLE_PROMPTS.slice(0, 4)) expect(hasRecordedAnswer([], q)).toBe(true);
  });
});
