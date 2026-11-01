import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, syntheticClearsMapping, syntheticLedgerMapping } from "./csv";
import { clearPlausibility, ledgerPlausibility } from "./plausibility";
import { ClearRowSchema, LedgerRowSchema } from "./schemas";

const HEADER = "kind,payee_name,amount,issue_date";

describe("spreadsheet line numbers", () => {
  it("counts blank lines and multi-line quoted cells like Excel does", () => {
    const text = [HEADER, "", 'check,"Multi', 'Line Co",bad,2024-01-01', "", "check,Fine Co,5.00,2024-01-01", "check,Late Co,oops,2024-01-01"].join("\n");
    const r = parseCsv(text, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.rows).toHaveLength(1);
    // the bad record starts on line 3 (header = 1, blank = 2); the last bad one is on line 7
    expect(r.errors.map((e) => e.row)).toEqual([3, 7]);
  });

  it("handles CRLF files", () => {
    const text = `${HEADER}\r\ncheck,A,1.00,2024-01-01\r\ncheck,B,zzz,2024-01-01\r\n`;
    expect(parseCsv(text, syntheticLedgerMapping, LedgerRowSchema).errors.map((e) => e.row)).toEqual([3]);
  });
});

describe("CSV parse errors are distinct from mapping errors", () => {
  it("reports an unclosed quote at the line where it opened", () => {
    const text = `${HEADER}\ncheck,A,1.00,2024-01-01\ncheck,"Broken Co,2.00,2024-01-02\ncheck,C,3.00,2024-01-03\n`;
    const r = parseCsv(text, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.rows).toEqual([]);
    expect(r.headerErrors).toEqual([]);
    expect(r.parseError).toEqual({ line: 3, message: "unclosed quote" });
  });

  it("reports a stray quote inside an unquoted field with its line", () => {
    const r = parseCsv(`${HEADER}\ncheck,Bob"s,1.00,2024-01-01\n`, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.parseError?.line).toBe(2);
    expect(r.parseError?.message).toMatch(/quote/);
  });

  it("does not set parseError for a mapping problem", () => {
    const r = parseCsv("kind,payee_name,amount\ncheck,A,1.00", syntheticLedgerMapping, LedgerRowSchema);
    expect(r.parseError).toBeUndefined();
    expect(r.headerErrors.length).toBeGreaterThan(0);
  });
});

describe("synthetic kinds", () => {
  it.each([
    ["vendor_check", "check"],
    ["Vendor Check", "check"],
    ["payroll_check", "payroll_check"],
    ["customer_credit", "credit"],
    ["unapplied_cash", "unapplied_cash"],
    ["check", "check"],
    ["credit", "credit"],
  ])("maps %s to %s", (raw, kind) => {
    const r = parseCsv(`${HEADER}\n${raw},A,1.00,2024-01-01`, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]!.kind).toBe(kind);
  });

  it("still rejects a genuinely unknown kind, naming it", () => {
    const r = parseCsv(`${HEADER}\nwidget,A,1.00,2024-01-01`, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.errors[0]).toMatchObject({ row: 2, field: "kind", message: "unknown kind 'widget'" });
  });

  it("imports the shipped ledger fixture with zero row errors", () => {
    const text = readFileSync(join(process.cwd(), "fixtures/synthetic/ledger.csv"), "utf8");
    const r = parseCsv(text, syntheticLedgerMapping, LedgerRowSchema, { refine: ledgerPlausibility("2026-11-01") });
    expect(r.errors).toEqual([]);
    expect(r.rows.length).toBeGreaterThan(700);
  });

  it("imports the shipped bank clears fixture with zero row errors", () => {
    const text = readFileSync(join(process.cwd(), "fixtures/synthetic/bank_clears.csv"), "utf8");
    const r = parseCsv(text, syntheticClearsMapping, ClearRowSchema, { refine: clearPlausibility("2026-11-01") });
    expect(r.errors).toEqual([]);
  });
});

describe("implausible values", () => {
  const refine = ledgerPlausibility("2026-11-01");
  it("rejects future issue dates and negative amounts with clear, constant messages", () => {
    const text = [
      HEADER,
      "check,Future Co,10.00,2031-03-04",
      "check,Negative Co,-5.00,2024-01-01",
      "check,Today Co,5.00,2026-11-01",
      "check,Fine Co,5.00,2024-01-01",
    ].join("\n");
    const r = parseCsv(text, syntheticLedgerMapping, LedgerRowSchema, { refine });
    expect(r.rows.map((x) => x.payeeName)).toEqual(["Today Co", "Fine Co"]);
    expect(r.errors).toEqual([
      expect.objectContaining({ row: 2, field: "issueDate", message: "issue date is after today (2026-11-01); future-dated items are not accepted" }),
      expect.objectContaining({ row: 3, field: "amount", message: "amount is negative; amounts must be positive" }),
    ]);
  });

  it("flags a future cleared date on bank clears", () => {
    const r = parseCsv("check_number,amount,cleared_date\n1,5.00,2030-01-01", syntheticClearsMapping, ClearRowSchema, {
      refine: clearPlausibility("2026-11-01"),
    });
    expect(r.errors[0]).toMatchObject({ row: 2, field: "clearedDate" });
  });
});
