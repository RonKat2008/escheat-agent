import { describe, expect, it } from "vitest";
import { addSeen, hasSeen, isValidSeenId, parseSeen, readCookie, seenCookie, SEEN_COOKIE } from "./seen";
import { formatWholeUSD, wholeDollars } from "./number-format";

describe("seen list", () => {
  it("parses, dedupes and drops malformed ids", () => {
    expect(parseSeen("activity,forecast,activity,BAD ID,,<x>")).toEqual(["activity", "forecast"]);
    expect(parseSeen(encodeURIComponent("activity,eval"))).toEqual(["activity", "eval"]);
    expect(parseSeen("%E0%A4%A")).toEqual([]);
    expect(parseSeen(null)).toEqual([]);
  });

  it("adds an id once and ignores invalid ids", () => {
    expect(addSeen("", "activity")).toBe("activity");
    expect(addSeen("activity", "activity")).toBe("activity");
    expect(addSeen("activity", "eval")).toBe("activity,eval");
    expect(addSeen("activity", "x;y=1")).toBe("activity");
    expect(hasSeen(addSeen(null, "forecast"), "forecast")).toBe(true);
    expect(hasSeen("activity", "forecast")).toBe(false);
  });

  it("keeps the list bounded so the cookie cannot grow without limit", () => {
    let raw = "";
    for (let i = 0; i < 40; i++) raw = addSeen(raw, `p${i}`);
    const list = parseSeen(raw);
    expect(list).toHaveLength(24);
    expect(list.at(-1)).toBe("p39");
    expect(list).not.toContain("p0");
  });

  it("validates ids strictly", () => {
    expect(isValidSeenId("activity")).toBe(true);
    expect(isValidSeenId("Activity")).toBe(false);
    expect(isValidSeenId("a".repeat(33))).toBe(false);
  });

  it("builds a session cookie and reads it back out of a cookie header", () => {
    const c = seenCookie("activity", "eval");
    expect(c).toBe(`${SEEN_COOKIE}=activity%2Ceval; Path=/; SameSite=Lax`);
    expect(c).not.toMatch(/Max-Age|Expires/i);
    const header = `foo=1; ${c.split(";")[0]}; bar=2`;
    expect(parseSeen(readCookie(header, SEEN_COOKIE))).toEqual(["activity", "eval"]);
    expect(readCookie("foo=1", SEEN_COOKIE)).toBeNull();
  });
});

describe("whole-dollar figures", () => {
  it("truncates like <Money wholeDollars/> and formats to match", () => {
    expect(wholeDollars(2552699)).toBe(25526);
    expect(formatWholeUSD(2552699)).toBe("$25,526");
    expect(formatWholeUSD(0)).toBe("$0");
    expect(wholeDollars(-150)).toBe(-1);
  });
});
