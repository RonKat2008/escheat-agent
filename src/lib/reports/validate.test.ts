import { describe, expect, it } from "vitest";
import { buildInput } from "./__fixtures__";
import { buildNaupaReport, expectedFromReport } from "./naupa";
import { allowedCodesFromRules, validateNaupaReport, type ExpectedReport } from "./validate";

const base = buildInput("CA", "remit");
const built = buildNaupaReport(base);
const expected: ExpectedReport = expectedFromReport(built, "CA", base.rules);
const errorsOf = (file: string, exp: ExpectedReport = expected) => validateNaupaReport(file, exp).filter((e) => e.severity === "error");

/** Overwrite `text` at 1-based byte `start` of 1-based record `rec`. */
function tamper(file: string, rec: number, start: number, text: string): string {
  const lines = file.split("\r\n");
  const l = lines[rec - 1]!;
  lines[rec - 1] = l.slice(0, start - 1) + text + l.slice(start - 1 + text.length);
  return lines.join("\r\n");
}

describe("validateNaupaReport", () => {
  it("accepts an untouched file (only the synthetic-TIN warning)", () => {
    const all = validateNaupaReport(built.file, expected);
    expect(all.filter((e) => e.severity === "error")).toEqual([]);
    expect(all.filter((e) => e.severity === "warning").map((w) => w.field)).toContain("HOLDER-TAXID");
  });

  it("catches one tampered amount (advertised, summary and expected totals disagree)", () => {
    const bad = tamper(built.file, 2, 309, "0000234001");
    const errs = errorsOf(bad);
    expect(errs.some((e) => e.record === 2 && e.field === "PROP-AMOUNT-ADVERTISED")).toBe(true);
    expect(errs.some((e) => e.field === "SUMM-AMOUNT-REPORTED")).toBe(true);
    expect(errs.some((e) => e.field === "totals")).toBe(true);
  });

  it("catches a truncated line", () => {
    const lines = built.file.split("\r\n");
    lines[1] = lines[1]!.slice(0, 600);
    const errs = errorsOf(lines.join("\r\n"));
    expect(errs.some((e) => e.record === 2 && /length is 600/.test(e.message))).toBe(true);
  });

  it("catches a padded (too long) line", () => {
    const lines = built.file.split("\r\n");
    lines[2] = `${lines[2]} `;
    expect(errorsOf(lines.join("\r\n")).some((e) => e.record === 3 && /length is 626/.test(e.message))).toBe(true);
  });

  it("catches a wrong summary total", () => {
    const bad = tamper(built.file, 5, 14, "000000999999");
    const errs = errorsOf(bad);
    expect(errs.some((e) => e.record === 5 && e.field === "SUMM-AMOUNT-REPORTED")).toBe(true);
  });

  it("catches wrong summary record / property counts", () => {
    const errs = errorsOf(tamper(tamper(built.file, 5, 2, "000009"), 5, 8, "000008"));
    expect(errs.map((e) => e.field)).toEqual(expect.arrayContaining(["SUMM-NBR-OF-RECORDS", "SUMM-NBR-OF-PROPERTIES"]));
  });

  it("catches totals that differ from the caller's expectation even when the file is self-consistent", () => {
    const errs = errorsOf(built.file, { ...expected, totalCents: expected.totalCents + 1 });
    expect(errs.some((e) => e.field === "totals")).toBe(true);
  });

  it("catches a per-code mismatch", () => {
    const errs = errorsOf(built.file, { ...expected, byPropertyCode: { ...expected.byPropertyCode, CK13: { count: 2, cents: 1 } } });
    expect(errs.some((e) => e.field === "totals" && e.message.includes("CK13"))).toBe(true);
  });

  it("catches a property code outside the state's allowed set", () => {
    const errs = errorsOf(tamper(built.file, 2, 305, "ZZ99"));
    expect(errs.some((e) => e.field === "PROP-PROPERTY-TYPE" && e.message.includes("ZZ99"))).toBe(true);
  });

  it("catches a code that is valid for another state only (TX MS04 in a CA file)", () => {
    const errs = errorsOf(tamper(built.file, 2, 305, "MS04"));
    expect(errs.some((e) => e.message.includes("MS04"))).toBe(true);
  });

  it("derives allowed codes from rules, including aggregate counterparts", () => {
    expect(allowedCodesFromRules(base.rules).sort()).toEqual(["CK13", "CK99", "MS01", "MS06", "MS09", "MS99"]);
  });

  it("requires an allowed-code source", () => {
    const errs = errorsOf(built.file, { state: "CA", totalCents: expected.totalCents });
    expect(errs.some((e) => /no allowed property-code set/.test(e.message))).toBe(true);
  });

  it("rejects a real-looking holder TIN", () => {
    const errs = errorsOf(tamper(built.file, 1, 2, "123456789"));
    expect(errs.some((e) => e.field === "HOLDER-TAXID" && /synthetic/.test(e.message))).toBe(true);
  });

  it("rejects non-numeric amount, invalid date, bad sequence", () => {
    expect(errorsOf(tamper(built.file, 2, 309, "00002340AB")).some((e) => e.field === "PROP-AMOUNT-REPORTED")).toBe(true);
    expect(errorsOf(tamper(built.file, 2, 289, "20240231")).some((e) => e.field === "PROP-ST-TRANS-DATE")).toBe(true);
    expect(errorsOf(tamper(built.file, 3, 2, "000005")).some((e) => e.field === "PROP-SEQUENCE-NUMBER")).toBe(true);
  });

  it("rejects a blank mandatory field and a blank enforced last-activity date", () => {
    expect(errorsOf(tamper(built.file, 2, 10, " ".repeat(40))).some((e) => e.field === "PROP-OWNER-NAME-LAST")).toBe(true);
    expect(errorsOf(tamper(built.file, 2, 289, "00000000")).some((e) => e.field === "PROP-ST-TRANS-DATE")).toBe(true);
  });

  it("rejects an illegal enumerated value", () => {
    expect(errorsOf(tamper(built.file, 2, 603, "XX")).some((e) => e.field === "PROP-OWNER-TYPE-CODE")).toBe(true);
    expect(errorsOf(tamper(built.file, 1, 19, "Q")).some((e) => e.field === "HOLDER-RPT-TYPE")).toBe(true);
  });

  it("flags aggregate/owner-type inconsistency", () => {
    const errs = errorsOf(tamper(built.file, 4, 603, "OT"));
    expect(errs.some((e) => e.field === "PROP-OWNER-TYPE-CODE")).toBe(true);
  });

  it("rejects bare LF separators", () => {
    expect(errorsOf(built.file.replace(/\r\n/g, "\n")).some((e) => e.field === "separator" || /length/.test(e.message))).toBe(true);
  });

  it("rejects non-ASCII content", () => {
    expect(errorsOf(tamper(built.file, 2, 10, "É")).some((e) => /non-ASCII/.test(e.message))).toBe(true);
  });

  it("rejects wrong record order / missing records", () => {
    const L = built.file.split("\r\n");
    expect(errorsOf([L[1], L[0], ...L.slice(2)].join("\r\n")).some((e) => /first record must be HOLDER/.test(e.message))).toBe(true);
    expect(errorsOf(L.slice(0, -1).join("\r\n")).some((e) => /last record must be SUMINFO/.test(e.message))).toBe(true);
    expect(errorsOf([...L.slice(0, -1), L[0], L[L.length - 1]].join("\r\n")).some((e) => /exactly one HOLDER/.test(e.message))).toBe(true);
  });

  it("rejects unknown TR-CODE and empty files", () => {
    expect(errorsOf(tamper(built.file, 3, 1, "4")).some((e) => /unknown or reserved TR-CODE/.test(e.message))).toBe(true);
    expect(errorsOf("")).toHaveLength(1);
  });

  it("accepts a trailing CRLF", () => {
    expect(errorsOf(`${built.file}\r\n`)).toEqual([]);
  });
});
