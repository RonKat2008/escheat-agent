import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { buildMarks, markState } from "./timeline-model";
import type { TimelineEvent } from "./types";

const TODAY = "2026-11-01" as IsoDate;
const ev = (over: Partial<TimelineEvent> & Pick<TimelineEvent, "key" | "kind" | "date" | "outcome">): TimelineEvent => ({
  itemId: over.key,
  state: "CA",
  amountCents: 1000,
  unverified: false,
  ...over,
});

describe("timeline marks", () => {
  const marks = buildMarks(
    [
      ev({ key: "a", kind: "report_due", date: "2026-12-01", outcome: "missed" }),
      ev({ key: "b", kind: "report_due", date: "2026-12-01", outcome: "missed", unverified: true }),
      ev({ key: "c", kind: "report_due", date: "2026-07-01", outcome: "missed" }),
      ev({ key: "d", kind: "remit_due", date: "2027-01-01", outcome: "met" }),
      ev({ key: "e", kind: "presumed_abandoned", date: "2026-11-20", outcome: "crossing" }),
      ev({ key: "f", kind: "remit_due", date: "2027-02-01", outcome: "moot" }),
    ],
    TODAY,
  );

  it("groups by lane and date, pins already-late dates to day 0, drops moot events", () => {
    expect(marks.map((m) => [m.kind, m.day, m.count, m.late])).toEqual([
      ["report_due", 0, 1, true],
      ["presumed_abandoned", 19, 1, false],
      ["report_due", 30, 2, false],
      ["remit_due", 61, 1, false],
    ]);
    expect(marks.find((m) => m.day === 30)?.unverified).toBe(true);
  });

  it("marks appear as the cursor reaches them; missed only strictly after the date", () => {
    const dec = marks.find((m) => m.day === 30)!;
    expect(markState(dec, 29)).toBe("hidden");
    expect(markState(dec, 30)).toBe("crossing");
    expect(markState(dec, 31)).toBe("missed");
    expect(markState(marks[0]!, 0)).toBe("missed");
    const met = marks.find((m) => m.kind === "remit_due")!;
    expect(markState(met, 100)).toBe("met");
    expect(markState(marks.find((m) => m.kind === "presumed_abandoned")!, 19)).toBe("crossing");
  });
});
