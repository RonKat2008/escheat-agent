import { describe, expect, it } from "vitest";
import { getChatTool } from "./tools";
import { answerableOffline, checkIn, matchOfflineIntent, stateIn } from "./offline-intent";
import { RECORDED_CHAT_GROUPS } from "./recorded-prompts";

const call = (q: string) => matchOfflineIntent(q)?.calls[0];

describe("offline intent mapping (R6-03)", () => {
  it("maps every recorded prompt to a known chat tool with valid input", () => {
    const prompts = Object.values(RECORDED_CHAT_GROUPS).flatMap((g) => [...(g.singles ?? []), ...(g.conversation ?? [])]);
    for (const p of prompts) {
      const intent = matchOfflineIntent(p);
      expect(intent, p).not.toBeNull();
      for (const c of intent!.calls) {
        const tool = getChatTool(c.name);
        expect(tool, c.name).toBeDefined();
        expect(tool!.input.safeParse(c.input).success, `${p} -> ${c.name}`).toBe(true);
      }
    }
  });

  it.each([
    ["What do we owe and where?", "get_exposure", {}],
    ["What do we owe in unclaimed property, and where?", "get_exposure", {}],
    ["What do we still owe?", "get_exposure", {}],
    ["What do we owe Texas?", "get_exposure", { state: "TX" }],
    ["What's due in the next 90 days?", "upcoming_deadlines", { days: 90 }],
    ["What’s due in the next 30 days?", "upcoming_deadlines", { days: 30 }],
    ["Any deadlines coming up?", "upcoming_deadlines", { days: 90 }],
    ["Explain check #10482", "explain_item", { item: "10482" }],
    ["why is 10087 due then", "explain_item", { item: "10087" }],
    ["Which rules are unverified?", "list_rules", {}],
    ["Verify the rules for CA", "list_rules", { state: "CA" }],
    ["Draft the due-diligence letter for #10087", "create_outreach_draft", { item: "10087" }],
    ["Generate the CA report", "generate_report", { state: "CA" }],
    ["generate the report for Delaware", "generate_report", { state: "DE" }],
    ["Close out Texas for this cycle", "plan_close_out", { state: "TX" }],
    ["What's left to close out TX?", "plan_close_out", { state: "TX" }],
  ])("%s -> %s", (q, name, input) => {
    expect(call(q)).toEqual({ name, input });
  });

  it("returns null for questions it cannot answer from the data, so chat says there is no recorded answer", () => {
    for (const q of [
      "What is the weather in Paris?",
      "How much interest do we owe Texas?",
      "What will we owe next year?",
      "Close out the cycle", // no state named
      "Draft a letter", // no check number
      "Generate a report", // no state named
      "Which items are in due diligence?",
      "Show recent agent runs",
      "",
    ]) {
      expect(matchOfflineIntent(q), q).toBeNull();
    }
  });

  it("never treats a day count as a check number, and prefers a full state name", () => {
    expect(checkIn("What's due in the next 90 days?")).toBeNull();
    expect(checkIn("Explain check #482")).toBe("482");
    expect(stateIn("Close out West Virginia")).toBe("WV");
    expect(stateIn("close out tx")).toBeNull(); // lower-case codes are too ambiguous ("in", "or", "me")
    expect(stateIn("What do we owe in unclaimed property?")).toBeNull();
  });

  it("drafting needs a check number and the draft tool; it is never mapped to an approve or send", () => {
    const intent = matchOfflineIntent("Draft the due-diligence letter for #10087");
    expect(intent?.id).toBe("draft_letter");
    expect(intent?.calls.map((c) => c.name)).toEqual(["create_outreach_draft"]);
    expect(matchOfflineIntent("Approve and send the letter for #10087")).toBeNull();
  });

  it("answerableOffline agrees with the mapping", () => {
    expect(answerableOffline("Generate the CA report")).toBe(true);
    expect(answerableOffline("What is the weather in Paris?")).toBe(false);
  });
});
