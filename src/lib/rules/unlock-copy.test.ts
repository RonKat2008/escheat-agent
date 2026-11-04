import { describe, expect, it } from "vitest";
import type { DraftableLetters } from "./adopt";
import { unlockCopy } from "./unlock-copy";

const none: DraftableLetters = { count: 0, amountCents: 0, upcoming: { count: 0, next: null }, noNoticeRequired: { count: 0, amountCents: 0, minAmountCents: null } };

describe("unlock copy (R5-01)", () => {
  it("the round-5 TX case: two sub-$250 items are never 'can now be drafted'; the next opening is named", () => {
    const c = unlockCopy("tx", {
      count: 0,
      amountCents: 0,
      upcoming: { count: 12, next: { opensOn: "2027-02-23", payeeName: "Rushmere Freight", amountCents: 92_431 } },
      noNoticeRequired: { count: 2, amountCents: 34_829, minAmountCents: 25_001 },
    });
    expect(c.headline).toBe("No TX letter can be drafted yet");
    expect(c.amountCents).toBeNull();
    expect(c.cta).toBeNull(); // nothing to go and do
    expect(c.lines).toEqual([
      "Next TX notice opens February 23, 2027: Rushmere Freight ($924.31). 11 more open after that.",
      "2 TX items ($348.29) are below TX's $250.01 notice minimum, so no letter is required.",
    ]);
  });

  it("draftable letters get the count, amount and a link to draft them", () => {
    const c = unlockCopy("TX", { ...none, count: 1, amountCents: 30_000 });
    expect(c.headline).toBe("1 TX letter can now be drafted");
    expect(c.amountCents).toBe(30_000);
    expect(c.cta).toEqual({ href: "/items?state=TX&status=dd_pending", label: "Draft the 1 letter from Items" });
    expect(c.lines).toEqual([]);
  });

  it("nothing at all says so plainly", () => {
    expect(unlockCopy("CA", none)).toEqual({ headline: "No CA letter can be drafted yet", amountCents: null, lines: ["No open CA item needs a notice right now."], cta: null });
  });
});
