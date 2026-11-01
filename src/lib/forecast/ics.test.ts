import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { DISCLAIMER } from "@/lib/disclaimer";
import { computeTimeline } from "@/lib/rules/engine";
import { rv, simpleFile } from "@/lib/rules/__fixtures__";
import { deadlineUid, forecastToIcs, UNVERIFIED_NOTE } from "./calendar";
import { buildForecast, type ForecastItemInput } from "./compute";
import { CRLF, escapeText, foldLine, writeIcs } from "./ics";

const d = (s: string) => s as IsoDate;
const octets = (s: string) => new TextEncoder().encode(s).length;
/** RFC 5545 unfolding: remove every CRLF followed by a single space. */
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma and every newline form", () => {
    expect(escapeText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
    expect(escapeText("one\r\ntwo\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour");
  });
  it("escapes backslashes first, so an escaped comma is not double-escaped", () => {
    expect(escapeText("\\,")).toBe("\\\\\\,");
  });
  it("leaves colons and quotes alone (allowed in TEXT)", () => {
    expect(escapeText('Due: "CA"')).toBe('Due: "CA"');
  });
});

describe("foldLine", () => {
  it("does not touch a line of exactly 75 octets", () => {
    const line = "X".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("folds long ASCII lines at 75 octets with CRLF + space, and unfolds losslessly", () => {
    const line = `DESCRIPTION:${"abcdefghij".repeat(20)}`;
    const folded = foldLine(line);
    const physical = folded.split(CRLF);
    expect(physical.length).toBeGreaterThan(1);
    expect(physical.every((l) => octets(l) <= 75)).toBe(true);
    expect(physical[0]).toHaveLength(75);
    expect(physical.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(unfold(folded)).toBe(line);
  });

  it("never splits a multi-byte UTF-8 character", () => {
    const line = `SUMMARY:${"é€😀".repeat(30)}`;
    const physical = foldLine(line).split(CRLF);
    expect(physical.every((l) => octets(l) <= 75)).toBe(true);
    // Each physical line must be valid UTF-8 on its own: decoding its bytes round-trips.
    for (const l of physical) expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(l))).toBe(l);
    expect(unfold(physical.join(CRLF))).toBe(line);
  });
});

describe("writeIcs", () => {
  const ics = writeIcs({
    prodId: "-//Test//EN",
    name: "Deadlines, test; one",
    stamp: d("2026-11-01"),
    events: [
      { uid: "u1@test", date: d("2027-12-31"), summary: "CA report due, notice; stage", description: "Line one\nLine two", categories: ["Unclaimed property", "CA"] },
    ],
  });

  it("uses CRLF for every line, including the last, and no bare LF or CR", () => {
    expect(ics.endsWith(CRLF)).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes the required calendar and event properties", () => {
    const lines = unfold(ics).split(CRLF);
    expect(lines.slice(0, 3)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN"]);
    expect(lines).toContain("X-WR-CALNAME:Deadlines\\, test\\; one");
    expect(lines).toContain("UID:u1@test");
    expect(lines).toContain("DTSTAMP:20261101T000000Z");
    expect(lines).toContain("DTSTART;VALUE=DATE:20271231");
    // All-day DTEND is exclusive: the next day, across a year boundary.
    expect(lines).toContain("DTEND;VALUE=DATE:20280101");
    expect(lines).toContain("SUMMARY:CA report due\\, notice\\; stage");
    expect(lines).toContain("DESCRIPTION:Line one\\nLine two");
    expect(lines).toContain("CATEGORIES:Unclaimed property,CA");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("every physical line is at most 75 octets", () => {
    expect(ics.split(CRLF).every((l) => octets(l) <= 75)).toBe(true);
  });
});

describe("forecastToIcs", () => {
  const item = (id: string, verifiedRoll: boolean, cents = 100_000): ForecastItemInput => {
    const file = simpleFile({ businessDayRollForward: rv<boolean>(true, verifiedRoll) });
    return {
      itemId: id,
      checkNumber: id,
      payeeName: `Payee ${id}`,
      state: "ZZ",
      amountCents: cents,
      timeline: computeTimeline({ propertyType: "vendor_check", lastActivityDate: d("2024-03-15"), amountCents: cents, ownerState: "ZZ" }, file),
    };
  };
  const opts = { companyId: "11111111-2222-4333-8444-555555555555", companyName: "Northwind, Inc." };

  it("emits DD-open, report and remit events (no presumed-abandoned), aggregated, with stable UIDs", () => {
    const forecast = buildForecast([item("a", true), item("b", true, 50_000)], { asOf: d("2026-11-01") });
    const a = forecastToIcs(forecast, opts);
    const b = forecastToIcs(buildForecast([item("b", true, 50_000), item("a", true)], { asOf: d("2026-11-01") }), opts);
    expect(a).toBe(b);
    const lines = unfold(a).split(CRLF);
    const summaries = lines.filter((l) => l.startsWith("SUMMARY:"));
    expect(summaries).toEqual([
      "SUMMARY:ZZ due-diligence window opens: 2 items\\, $1\\,500.00",
      "SUMMARY:ZZ report due (annual stage): 2 items\\, $1\\,500.00",
      "SUMMARY:ZZ remittance due: 2 items\\, $1\\,500.00",
    ]);
    const uids = lines.filter((l) => l.startsWith("UID:"));
    expect(new Set(uids).size).toBe(3);
    expect(uids).toContain(`UID:${deadlineUid(opts.companyId, { kind: "report_due", state: "ZZ", stage: "annual", date: d("2027-11-01") })}`);
    expect(unfold(a)).toContain(escapeText(DISCLAIMER));
  });

  it("marks events that depend on unverified rules", () => {
    const ics = unfold(forecastToIcs(buildForecast([item("u", false)], { asOf: d("2026-11-01") }), opts));
    expect(ics).toContain("[unverified]");
    expect(ics).toContain(escapeText(UNVERIFIED_NOTE));
  });

  it("UIDs differ per company and are stable per date/kind/state/stage", () => {
    const key = { kind: "remit_due" as const, state: "CA", stage: null, date: d("2027-11-01") };
    expect(deadlineUid("c1", key)).toBe(deadlineUid("c1", key));
    expect(deadlineUid("c1", key)).not.toBe(deadlineUid("c2", key));
    expect(deadlineUid("c1", key)).toMatch(/^remit-due-ca-main-20271101-[0-9a-f]{12}@escheat-agent$/);
  });
});
