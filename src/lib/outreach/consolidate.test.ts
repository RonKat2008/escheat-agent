import { describe, expect, it } from "vitest";
import { absorbedOutreachIds, groupNotices, itemNoun, needsConsolidation, noticeKey, planConsolidation, totalCents, type NoticeCandidate } from "./consolidate";
import { CALL_AFTER_EMAIL_DAYS, EMAIL_AFTER_LETTER_DAYS, planNoticeSequence, sequenceDayLabel } from "./sequence";

const c = (over: Partial<NoticeCandidate> & Pick<NoticeCandidate, "outreachId" | "staleItemId">): NoticeCandidate => ({
  ownerPayeeId: "payee-bayline",
  state: "CA",
  referenceNumber: over.staleItemId.toUpperCase(),
  issueDate: "2025-09-01",
  amountCents: 10_000,
  itemCount: 1,
  ...over,
});

describe("groupNotices (one notice per owner and state)", () => {
  it("merges the same owner in the same state into one notice, in letter order, with an integer-cents total", () => {
    const [g, ...rest] = groupNotices([
      c({ outreachId: "o2", staleItemId: "s2", referenceNumber: "10537", issueDate: "2025-09-15", amountCents: 378_671 }),
      c({ outreachId: "o1", staleItemId: "s1", referenceNumber: "10482", issueDate: "2025-09-01", amountCents: 234_000 }),
    ]);
    expect(rest).toEqual([]);
    expect(g!.key).toBe("payee-bayline|CA");
    expect(g!.items.map((i) => i.referenceNumber)).toEqual(["10482", "10537"]);
    expect(g!.totalCents).toBe(612_671);
    expect(Number.isInteger(g!.totalCents)).toBe(true);
    // The lead is the earliest item's letter; the other letter is absorbed.
    expect(g!.leadOutreachId).toBe("o1");
    expect(absorbedOutreachIds(g!)).toEqual(["o2"]);
  });

  it("never merges different states, even for the same owner", () => {
    const groups = groupNotices([
      c({ outreachId: "o1", staleItemId: "s1", state: "CA" }),
      c({ outreachId: "o2", staleItemId: "s2", state: "TX" }),
      c({ outreachId: "o3", staleItemId: "s3", state: "de" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["payee-bayline|CA", "payee-bayline|TX", "payee-bayline|DE"]);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it("never merges different owners, or items whose owner or state is unknown", () => {
    const groups = groupNotices([
      c({ outreachId: "o1", staleItemId: "s1", ownerPayeeId: "a" }),
      c({ outreachId: "o2", staleItemId: "s2", ownerPayeeId: "b" }),
      c({ outreachId: "o3", staleItemId: "s3", ownerPayeeId: null }),
      c({ outreachId: "o4", staleItemId: "s4", ownerPayeeId: null }),
      c({ outreachId: "o5", staleItemId: "s5", state: null }),
      c({ outreachId: "o6", staleItemId: "s6", state: null }),
    ]);
    expect(groups).toHaveLength(6);
    expect(noticeKey({ ownerPayeeId: null, state: "CA", staleItemId: "s3" })).toBe("solo:s3");
    expect(noticeKey({ ownerPayeeId: "a", state: null, staleItemId: "s5" })).toBe("solo:s5");
  });

  it("lists an item once, and keeps the letter that already covers the most items as the lead", () => {
    const [g] = groupNotices([
      c({ outreachId: "notice", staleItemId: "s2", itemCount: 2, issueDate: "2025-10-01" }),
      c({ outreachId: "notice", staleItemId: "s3", itemCount: 2, issueDate: "2025-11-01" }),
      c({ outreachId: "single", staleItemId: "s1", issueDate: "2025-01-01" }),
      c({ outreachId: "single-dup", staleItemId: "s2" }),
    ]);
    expect(g!.items.map((i) => i.staleItemId)).toEqual(["s1", "s2", "s3"]);
    expect(g!.leadOutreachId).toBe("notice");
    expect(absorbedOutreachIds(g!)).toEqual(["single"]);
  });

  it("orders items by issue date, then check number numerically", () => {
    const [g] = groupNotices([
      c({ outreachId: "o1", staleItemId: "a", referenceNumber: "10", issueDate: "2025-01-01" }),
      c({ outreachId: "o2", staleItemId: "b", referenceNumber: "9", issueDate: "2025-01-01" }),
    ]);
    expect(g!.items.map((i) => i.referenceNumber)).toEqual(["9", "10"]);
  });
});

describe("totalCents", () => {
  it("adds integer cents exactly (no float drift)", () => {
    expect(totalCents([{ amountCents: 10 }, { amountCents: 20 }, { amountCents: 1 }])).toBe(31);
    expect(totalCents([{ amountCents: 234_000 }, { amountCents: 378_671 }])).toBe(612_671);
    expect(totalCents([])).toBe(0);
  });

  it("refuses a non-integer amount", () => {
    expect(() => totalCents([{ amountCents: 10.5 }])).toThrow(RangeError);
  });
});

describe("needsConsolidation / planConsolidation", () => {
  const two = [c({ outreachId: "o1", staleItemId: "s1" }), c({ outreachId: "o2", staleItemId: "s2", issueDate: "2025-10-01" })];

  it("needs composing while two letters are open for one owner", () => {
    const coverage = new Map([
      ["o1", ["s1"]],
      ["o2", ["s2"]],
    ]);
    expect(planConsolidation(two, coverage)).toHaveLength(1);
  });

  it("is settled once one letter lists exactly the group's items, and re-opens when an item is added", () => {
    const combined = [c({ outreachId: "o1", staleItemId: "s1", itemCount: 2 }), c({ outreachId: "o1", staleItemId: "s2", itemCount: 2, issueDate: "2025-10-01" })];
    const coverage = new Map([["o1", ["s1", "s2"]]]);
    expect(planConsolidation(combined, coverage)).toEqual([]);
    const added = [...combined, c({ outreachId: "o3", staleItemId: "s3", issueDate: "2025-12-01" })];
    const [g] = planConsolidation(added, new Map([...coverage, ["o3", ["s3"]]]));
    expect(g!.leadOutreachId).toBe("o1");
    expect(needsConsolidation(g!, coverage)).toBe(true);
  });

  it("leaves single-item letters alone", () => {
    expect(planConsolidation([c({ outreachId: "o1", staleItemId: "s1" })], new Map([["o1", ["s1"]]]))).toEqual([]);
  });
});

describe("itemNoun", () => {
  it("says checks only when every item is a check", () => {
    expect(itemNoun(2, true)).toBe("checks");
    expect(itemNoun(1, true)).toBe("check");
    expect(itemNoun(3, false)).toBe("items");
  });
});

describe("planNoticeSequence (product setting, not law)", () => {
  it("puts the letter first, the email N days later, then the call", () => {
    const plan = planNoticeSequence("2026-11-03");
    expect(plan.map((p) => p.channel)).toEqual(["letter", "email", "voice"]);
    expect(plan.map((p) => p.offsetDays)).toEqual([0, EMAIL_AFTER_LETTER_DAYS, EMAIL_AFTER_LETTER_DAYS + CALL_AFTER_EMAIL_DAYS]);
    expect(plan[1]!.plannedOn).toBe("2026-11-17");
    expect(sequenceDayLabel(plan[1]!)).toBe(`Day ${EMAIL_AFTER_LETTER_DAYS}`);
  });

  it("has no dates before the letter has gone out", () => {
    expect(planNoticeSequence(null).every((p) => p.plannedOn === null)).toBe(true);
  });
});
