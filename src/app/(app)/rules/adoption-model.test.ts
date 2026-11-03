import { describe, expect, it } from "vitest";
import { addressedToHolder, canApprove, diffSegments, impactCopy, quoteSegments } from "./adoption-model";

const QUOTE =
  "The notice must include the following language: (1) You (the holder) are holding the property; and (2) You (the holder) may be required to deliver the property.";
const PROPOSED = "(1) You (the holder) are holding the property; and (2) You (the holder) may be required to deliver the property.";

describe("quoteSegments", () => {
  it("highlights exactly the proposed text inside the quote", () => {
    const s = quoteSegments(QUOTE, PROPOSED);
    expect(s).toEqual([
      { text: "The notice must include the following language: ", match: false },
      { text: PROPOSED, match: true },
    ]);
    expect(s.map((x) => x.text).join("")).toBe(QUOTE);
  });

  it("keeps text on both sides and never highlights a text that is not in the quote", () => {
    expect(quoteSegments("a b c", "b")).toEqual([
      { text: "a ", match: false },
      { text: "b", match: true },
      { text: " c", match: false },
    ]);
    expect(quoteSegments("a b c", "z")).toEqual([{ text: "a b c", match: false }]);
    expect(quoteSegments("a b c", "")).toEqual([{ text: "a b c", match: false }]);
  });
});

describe("diffSegments", () => {
  it("shows an unknown value becoming the proposed text as one addition", () => {
    expect(diffSegments(null, PROPOSED)).toEqual([{ kind: "added", text: PROPOSED }]);
  });

  it("marks removed and added words around the shared ones", () => {
    const d = diffSegments("We are holding your property", "We are holding the property");
    expect(d).toEqual([
      { kind: "same", text: "We are holding " },
      { kind: "removed", text: "your" },
      { kind: "added", text: "the" },
      { kind: "same", text: " property" },
    ]);
    const before = d.filter((x) => x.kind !== "added").map((x) => x.text).join("");
    const after = d.filter((x) => x.kind !== "removed").map((x) => x.text).join("");
    expect(before).toBe("We are holding your property");
    expect(after).toBe("We are holding the property");
  });

  it("keeps identical text as one unchanged segment", () => {
    expect(diffSegments("same text", "same text")).toEqual([{ kind: "same", text: "same text" }]);
  });
});

describe("impactCopy", () => {
  const impact = {
    blockedByRule: { count: 4, amountCents: 120_050 },
    becomeDraftable: { count: 2, amountCents: 75_050, staleItemIds: ["a", "b"] },
    stillBlocked: { count: 2, amountCents: 45_000, byReason: { missing_owner_address: 1, window_not_open: 1 } },
  };

  it("says how many letters become draftable, with the amount, and why the rest stay blocked", () => {
    const c = impactCopy("tx", impact)!;
    expect(c.headline).toBe("2 TX letters ($750.50) become draftable; 2 stay blocked ($450.00).");
    expect(c.reasons).toEqual(["1 letter: the owner has no mailing address", "1 letter: the notice window has not opened yet"]);
    expect(c.draftableCount).toBe(2);
    expect(c.stillBlockedCount).toBe(2);
  });

  it("uses the singular and omits the blocked clause when nothing stays blocked", () => {
    const c = impactCopy("TX", { ...impact, becomeDraftable: { count: 1, amountCents: 5_000, staleItemIds: ["a"] }, stillBlocked: { count: 0, amountCents: 0, byReason: {} } })!;
    expect(c.headline).toBe("1 TX letter ($50.00) becomes draftable.");
    expect(c.reasons).toEqual([]);
  });

  it("is honest when nothing is blocked, and null when the rule does not gate letters", () => {
    const none = { blockedByRule: { count: 0, amountCents: 0 }, becomeDraftable: { count: 0, amountCents: 0, staleItemIds: [] }, stillBlocked: { count: 0, amountCents: 0, byReason: {} } };
    expect(impactCopy("TX", none)!.headline).toBe("No TX letters are blocked by this rule right now.");
    expect(impactCopy("TX", null)).toBeNull();
  });
});

describe("addressedToHolder / canApprove", () => {
  it("detects holder-addressed official text", () => {
    expect(addressedToHolder(PROPOSED)).toBe(true);
    expect(addressedToHolder("We are holding your property.")).toBe(false);
  });
  it("needs a name of two or more characters", () => {
    expect(canApprove("")).toBe(false);
    expect(canApprove("  D ")).toBe(false);
    expect(canApprove("Dana")).toBe(true);
  });
});
