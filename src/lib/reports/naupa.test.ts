import { describe, expect, it } from "vitest";
import { buildInput, HOLDER, item, ITEMS, loadFile, withNullCode } from "./__fixtures__";
import { RECORD_LENGTH } from "./layout";
import { buildNaupaReport, expectedFromReport } from "./naupa";
import { parseNaupaReport } from "./parse";
import { validateNaupaReport } from "./validate";

const lines = (file: string) => file.split("\r\n");

describe("buildNaupaReport: CA remit report (golden)", () => {
  const input = buildInput("CA", "remit");
  const r = buildNaupaReport(input);
  const L = lines(r.file);

  it("passes its own validator with no errors", () => {
    expect(r.errors).toEqual([]);
    expect(validateNaupaReport(r.file, expectedFromReport(r, "CA", input.rules)).filter((e) => e.severity === "error")).toEqual([]);
  });

  it("writes HOLDER, 2 named PROPERTY, 1 aggregate PROPERTY, SUMINFO joined by CRLF", () => {
    expect(L).toHaveLength(5);
    expect(L.map((l) => l[0])).toEqual(["1", "2", "2", "2", "9"]);
    expect(r.file.includes("\n")).toBe(true);
    expect(r.file.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(r.file.endsWith("\r\n")).toBe(false);
  });

  it("every record is exactly 625 bytes of printable ASCII", () => {
    for (const l of L) {
      expect(l).toHaveLength(RECORD_LENGTH);
      expect(Buffer.byteLength(l, "latin1")).toBe(RECORD_LENGTH);
      expect(l).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("pads alpha left/space and numeric right/zero at the spec byte positions", () => {
    const holder = L[0]!;
    expect(holder.slice(1, 10)).toBe("000000000"); // synthetic TIN
    expect(holder.slice(10, 14)).toBe("0001");
    expect(holder.slice(14, 18)).toBe("2026");
    expect(holder.slice(18, 19)).toBe("R"); // remit stage
    expect(holder.slice(36, 76)).toBe("NORTHWIND FIXTURES INC".padEnd(40, " "));
    const p1 = L[1]!;
    expect(p1.slice(1, 7)).toBe("000001");
    expect(p1.slice(7, 8)).toBe("P");
    expect(p1.slice(8, 9)).toBe("C");
    expect(p1.slice(9, 49)).toBe("BAYLINE ELECTRIC".padEnd(40, " "));
    expect(p1.slice(288, 296)).toBe("20240815");
    expect(p1.slice(304, 308)).toBe("CK13");
    expect(p1.slice(308, 318)).toBe("0000234000");
    expect(p1.slice(364, 374)).toBe("0000234000"); // remitted
    expect(p1.slice(530, 550)).toBe("10482".padEnd(20, " "));
    expect(p1.slice(600, 602)).toBe("PA");
    expect(p1.slice(602, 604)).toBe("OT");
    expect(p1.slice(604, 625)).toBe(" ".repeat(21));
    const p2 = L[2]!;
    expect(p2.slice(8, 9)).toBe(" "); // person: PROP-NAME-ID blank
    expect(p2.slice(9, 49)).toBe("DOE".padEnd(40, " "));
    expect(p2.slice(49, 79)).toBe("JANE".padEnd(30, " "));
    expect(p2.slice(304, 308)).toBe("MS01");
    expect(p2.slice(308, 318)).toBe("0000025300"); // spec example: $253 = 0000025300
  });

  it("aggregates the two under-$25 items into one CK99 / AP row", () => {
    const agg = L[3]!;
    expect(agg.slice(304, 308)).toBe("CK99");
    expect(agg.slice(602, 604)).toBe("AP");
    expect(agg.slice(308, 318)).toBe("0000002050");
    expect(agg.slice(550, 600)).toBe("AGGREGATE OF 2 ITEMS".padEnd(50, " "));
    expect(r.totals.byPropertyCode).toEqual({
      CK13: { count: 1, cents: 234000 },
      MS01: { count: 1, cents: 25300 },
      CK99: { count: 1, cents: 2050 },
    });
  });

  it("totals reconcile: items, sum, summary record", () => {
    const sum = ITEMS.reduce((s, i) => s + i.amountCents, 0);
    expect(r.totals).toMatchObject({ itemCount: 4, totalCents: sum, propertyRecordCount: 3 });
    const sumRec = L[4]!;
    expect(sumRec.slice(1, 7)).toBe("000005"); // all records incl HOLDER and SUMINFO
    expect(sumRec.slice(7, 13)).toBe("000003");
    expect(sumRec.slice(13, 25)).toBe(String(sum).padStart(12, "0"));
    expect(sumRec.slice(73, 85)).toBe(String(sum).padStart(12, "0")); // remitted
    expect(sumRec.slice(141, 142)).toBe(" ");
  });

  it("round trips: parse(build) equals the returned records", () => {
    const parsed = parseNaupaReport(r.file);
    expect(parsed.records).toEqual(r.records);
    expect(parsed.lineCount).toBe(5);
    expect(parsed.holder).toMatchObject({ name: "NORTHWIND FIXTURES INC", reportType: "R", reportYear: "2026", taxId: "000000000" });
    expect(parsed.properties.map((p) => [p.propertyType, p.amountReportedCents, p.isAggregate])).toEqual([
      ["CK13", 234000, false],
      ["MS01", 25300, false],
      ["CK99", 2050, true],
    ]);
    expect(parsed.properties[0]).toMatchObject({ lastActivityDate: "2024-08-15", checkNumber: "10482", ownerState: "CA" });
    expect(parsed.summary).toMatchObject({ recordCount: 5, propertyCount: 3, amountReportedCents: 261350, amountRemittedCents: 261350, negativeReport: false });
  });

  it("is deterministic", () => {
    expect(buildNaupaReport(input).file).toBe(r.file);
  });

  it("warns that the TIN is synthetic", () => {
    expect(r.warnings.some((w) => w.includes("SYNTHETIC placeholder TIN"))).toBe(true);
  });
});

describe("CA two-stage", () => {
  it("notice report carries no money; remit report does", () => {
    const notice = buildNaupaReport(buildInput("CA", "notice"));
    const remit = buildNaupaReport(buildInput("CA", "remit"));
    expect(notice.reportTypeCode).toBe("A");
    expect(remit.reportTypeCode).toBe("R");
    expect(notice.stage.includesRemittance).toBe(false);
    expect(remit.stage.includesRemittance).toBe(true);
    const n = parseNaupaReport(notice.file);
    const m = parseNaupaReport(remit.file);
    expect(n.properties.every((p) => p.amountRemittedCents === 0)).toBe(true);
    expect(n.summary?.amountRemittedCents).toBe(0);
    expect(n.summary?.amountReportedCents).toBe(m.summary?.amountReportedCents);
    expect(m.properties.every((p) => p.amountRemittedCents === p.amountAdvertisedCents)).toBe(true);
    expect(notice.errors).toEqual([]);
    expect(remit.errors).toEqual([]);
  });

  it("flags the unconfirmed CA notice report type", () => {
    expect(buildNaupaReport(buildInput("CA", "notice")).warnings.join("\n")).toMatch(/not confirmed/);
  });

  it("validator rejects money in a notice report and a missing remittance in a remit report", () => {
    const remit = buildNaupaReport(buildInput("CA", "remit"));
    const asNotice = validateNaupaReport(remit.file, { ...expectedFromReport(remit, "CA", loadFile("CA")), includesRemittance: false });
    expect(asNotice.some((e) => e.field === "PROP-AMOUNT-REMITTED")).toBe(true);
    expect(asNotice.some((e) => e.field === "HOLDER-RPT-TYPE")).toBe(true);
    const notice = buildNaupaReport(buildInput("CA", "notice"));
    const asRemit = validateNaupaReport(notice.file, { ...expectedFromReport(notice, "CA", loadFile("CA")), includesRemittance: true });
    expect(asRemit.some((e) => e.field === "PROP-AMOUNT-REMITTED")).toBe(true);
  });

  it("rejects an unknown stage", () => {
    expect(() => buildNaupaReport(buildInput("CA", "annual"))).toThrow(/no report stage/);
  });
});

describe("aggregate handling", () => {
  it("DE has no aggregate threshold in its rule file: no aggregation + warning", () => {
    const r = buildNaupaReport(buildInput("DE", "annual"));
    expect(r.totals.propertyRecordCount).toBe(4);
    expect(r.totals.byPropertyCode).not.toHaveProperty("CK99");
    expect(r.warnings.some((w) => /aggregate threshold for vendor_check is unknown/.test(w))).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("an item exactly at the threshold is reported individually", () => {
    const r = buildNaupaReport(buildInput("CA", "remit", { items: [item({ id: "x", amountCents: 2500 }), item({ id: "y", amountCents: 2499 })] }));
    expect(r.totals.byPropertyCode).toEqual({ CK13: { count: 1, cents: 2500 }, CK99: { count: 1, cents: 2499 } });
  });

  it("aggregateSmall:false disables aggregation", () => {
    const r = buildNaupaReport(buildInput("CA", "remit", { aggregateSmall: false }));
    expect(r.totals.propertyRecordCount).toBe(4);
  });

  it("uses the TX threshold and TX's MS04 code, aggregate MS99", () => {
    const r = buildNaupaReport(buildInput("TX", "annual"));
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.totals.byPropertyCode).sort()).toEqual(["MS01", "MS04", "MS99"]);
  });
});

describe("naupa code handling", () => {
  it("null naupaCode in the rule file is a validation error and the item is left out", () => {
    const rules = withNullCode(loadFile("CA"), "payroll_check");
    const r = buildNaupaReport(buildInput("CA", "remit", { rules }));
    expect(r.excludedItemIds).toEqual(["i4"]);
    expect(r.errors.some((e) => e.field === "PROP-PROPERTY-TYPE" && e.message.includes("i4"))).toBe(true);
    expect(r.totals.itemCount).toBe(3);
    expect(r.file).not.toContain("MS01");
  });

  it("throws when the rule file is for another state", () => {
    expect(() => buildNaupaReport(buildInput("CA", "remit", { rules: loadFile("TX") }))).toThrow(/rule file is for TX/);
  });
});

describe("text handling", () => {
  it("strips non-ASCII and folds accents", () => {
    const r = buildNaupaReport(buildInput("TX", "annual", { items: [item({ id: "u", ownerName: { last: "Zoë Ünal ☃ 株式会社" }, city: "São Paulo" })] }));
    const line = r.file.split("\r\n")[1]!;
    expect(line).toMatch(/^[\x20-\x7e]+$/);
    expect(line.slice(9, 49).trim()).toBe("ZOE UNAL");
    expect(line.slice(205, 235).trim()).toBe("SAO PAULO");
  });

  it("strips punctuation from the holder name and truncates long values with a warning", () => {
    const r = buildNaupaReport(buildInput("TX", "annual", { holder: { ...HOLDER, name: "A".repeat(50) }, items: [item({ id: "t", ownerName: { last: "B".repeat(45) } })] }));
    const L = r.file.split("\r\n");
    expect(L[0]!.slice(36, 76)).toBe("A".repeat(40));
    expect(L[1]!.slice(9, 49)).toBe("B".repeat(40));
    expect(r.warnings.filter((w) => w.includes("truncated")).map((w) => w.slice(0, 40))).toEqual([expect.stringContaining("HOLDER-NAME"), expect.stringContaining("PROPERTY 1")]);
  });

  it("amount over 10 digits is excluded with an error", () => {
    const r = buildNaupaReport(buildInput("TX", "annual", { items: [item({ id: "big", amountCents: 10_000_000_000 })] }));
    expect(r.excludedItemIds).toEqual(["big"]);
    expect(r.errors.some((e) => e.field === "PROP-AMOUNT-REPORTED")).toBe(true);
  });

  it("empty owner name is excluded", () => {
    const r = buildNaupaReport(buildInput("TX", "annual", { items: [item({ id: "n", ownerName: { last: "   " } })] }));
    expect(r.excludedItemIds).toEqual(["n"]);
  });
});

describe("negative report", () => {
  it("no items => HOLDER + SUMINFO (2 records) with the negative flag", () => {
    const r = buildNaupaReport(buildInput("TX", "annual", { items: [] }));
    const L = r.file.split("\r\n");
    expect(L).toHaveLength(2);
    expect(L[1]!.slice(141, 142)).toBe("Y");
    expect(r.errors).toEqual([]);
    expect(r.totals.totalCents).toBe(0);
  });
});
