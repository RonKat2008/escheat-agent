import { describe, expect, it } from "vitest";
import { isStale } from "@/lib/recon/reconcile";
import { bucketByDaysUntilStale, bucketsTotalCents } from "./buckets";
import { HORIZON_CSV_HEADER, horizonCsv } from "./csv";
import { daysUntilStaleAt, isStaleAtAge, phaseAtAge, projectItem, provisionalOwnerState, sortWorklist, type HorizonSource } from "./project";

const CTX = { thresholdDays: 180, holderFiscalYearEnd: "12-31" };
const src = (over: Partial<HorizonSource> = {}): HorizonSource => ({
  ledgerItemId: "l1",
  checkNumber: "10620",
  payeeName: "Wrenfield Cabinetry",
  propertyType: "vendor_check",
  amountCents: 125_000,
  issueDate: "2026-05-05",
  lastActivityDate: null,
  addressState: "TX",
  ageDays: 180,
  ...over,
});

describe("stale boundary (same rule as detection)", () => {
  it("the exact 180-day item reaches the stale threshold at 180 and counts as stale from day 181", () => {
    // 2026-05-05 + 180 days = 2026-11-01 (the demo anchor).
    expect(isStale({ issueDate: "2026-05-05" }, "2026-11-01", 180)).toBe(false);
    expect(isStaleAtAge(180, 180)).toBe(false);
    expect(isStaleAtAge(181, 180)).toBe(true);
    const p = projectItem(src(), CTX);
    expect(p.daysUntilStale).toBe(1);
    expect(p.staleOn).toBe("2026-11-02");
    expect(isStale({ issueDate: "2026-05-05" }, p.staleOn, 180)).toBe(true);
    // Projected forward one day by the scrubber, it is stale.
    expect(phaseAtAge(p.ageDays + 1, 180, p.presumedAtAgeDays)).toBe("stale");
  });

  it("daysUntilStale never goes negative", () => {
    expect(daysUntilStaleAt(400, 180)).toBe(0);
    expect(daysUntilStaleAt(12, 180)).toBe(169);
  });
});

describe("projectItem", () => {
  it("uses the rules engine for a supported address state, flagged provisional and unverified where the rule is", () => {
    const p = projectItem(src(), CTX);
    expect(p.ownerState).toBe("TX");
    expect(p.dates?.presumedAbandoned).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.dates?.ruleVersion).toBeTruthy();
    expect(p.presumedAtAgeDays).toBeGreaterThan(180);
    expect(phaseAtAge(p.presumedAtAgeDays!, 180, p.presumedAtAgeDays)).toBe("presumed_abandoned");
  });

  it("a missing owner state gives UNKNOWN dates, never a guess", () => {
    const p = projectItem(src({ addressState: null }), CTX);
    expect(p.ownerState).toBeNull();
    expect(p.dates).toBeNull();
    expect(p.presumedAtAgeDays).toBeNull();
    expect(p.unknownReason).toMatch(/could not be determined/);
  });

  it("an unsupported state gives UNKNOWN dates with the reason", () => {
    const p = projectItem(src({ addressState: "ny" }), CTX);
    expect(p.ownerState).toBe("NY");
    expect(p.dates).toBeNull();
    expect(p.unknownReason).toMatch(/No rule file for NY/);
  });

  it("only a two-letter address state counts", () => {
    expect(provisionalOwnerState(" ca ")).toBe("CA");
    expect(provisionalOwnerState("California")).toBeNull();
    expect(provisionalOwnerState("")).toBeNull();
    expect(provisionalOwnerState(undefined)).toBeNull();
  });

  it("sorts soonest-to-stale first, then larger amounts", () => {
    const a = projectItem(src({ ledgerItemId: "a", ageDays: 10, amountCents: 5 }), CTX);
    const b = projectItem(src({ ledgerItemId: "b", ageDays: 170, amountCents: 5 }), CTX);
    const c = projectItem(src({ ledgerItemId: "c", ageDays: 170, amountCents: 9 }), CTX);
    expect(sortWorklist([a, b, c]).map((i) => i.ledgerItemId)).toEqual(["c", "b", "a"]);
  });
});

describe("buckets", () => {
  it("are disjoint 30/60/90/later and sum to the total", () => {
    const items = [0, 30, 31, 60, 61, 90, 91, 170].map((d, i) => ({ daysUntilStale: d, amountCents: (i + 1) * 100 }));
    const b = bucketByDaysUntilStale(items);
    expect(b.map((x) => x.count)).toEqual([2, 2, 2, 2]);
    expect(b.map((x) => x.cents)).toEqual([300, 700, 1100, 1500]);
    expect(bucketsTotalCents(b)).toBe(items.reduce((s, i) => s + i.amountCents, 0));
  });

  it("empty input yields four zero buckets", () => {
    expect(bucketByDaysUntilStale([]).every((x) => x.count === 0 && x.cents === 0)).toBe(true);
  });
});

describe("worklist CSV", () => {
  it("has a header, one row per item, UNKNOWN for missing dates, and escapes formula-leading payees", () => {
    const known = projectItem(src(), CTX);
    const unknown = projectItem(src({ ledgerItemId: "u", addressState: null, payeeName: '=HYPERLINK("x")', checkNumber: "10704" }), CTX);
    const lines = horizonCsv([known, unknown]).trimEnd().split("\r\n");
    expect(lines[0]).toBe(HORIZON_CSV_HEADER.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("1250.00");
    expect(lines[1]).toContain("PROVISIONAL");
    expect(lines[2]).toContain("UNKNOWN: Owner state could not be determined.");
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
