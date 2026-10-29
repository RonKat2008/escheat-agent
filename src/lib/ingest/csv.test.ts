import { describe, expect, it } from "vitest";
import {
  parseAmountToCents,
  parseCsv,
  parseDate,
  readHeaders,
  suggestMapping,
  syntheticClearsMapping,
  syntheticLedgerMapping,
  type ColumnMapping,
} from "./csv";
import { ClearRowSchema, LedgerRowSchema } from "./schemas";

describe("parseAmountToCents", () => {
  it.each([
    ["$1,234.56", 123456],
    ["(12.00)", -1200],
    ["1234.5", 123450],
    ["2340.00", 234000],
    ["-5", -500],
    ["0.07", 7],
    [" $ 10 ", 1000],
    ["12.00-", -1200],
  ])("parses %s", (raw, cents) => expect(parseAmountToCents(raw)).toBe(cents));

  it.each(["", "abc", "1.234", "12,34", "1.2.3"])("rejects %j", (raw) =>
    expect(() => parseAmountToCents(raw)).toThrow(),
  );
});

describe("parseDate", () => {
  it("parses ISO, US 4-digit and US 2-digit years", () => {
    expect(parseDate("2024-03-09")).toBe("2024-03-09");
    expect(parseDate("3/9/2024")).toBe("2024-03-09");
    expect(parseDate("03/09/24")).toBe("2024-03-09");
    expect(parseDate("1/2/99")).toBe("1999-01-02");
  });
  it("honours an explicit format", () => {
    expect(parseDate("3/9/24", "M/D/YY")).toBe("2024-03-09");
    expect(() => parseDate("2024-03-09", "MM/DD/YYYY")).toThrow();
    expect(() => parseDate("3/9/2024", "M/D/YY")).toThrow();
  });
  it("rejects impossible dates", () => {
    expect(() => parseDate("2024-02-30")).toThrow(/real calendar/);
    expect(() => parseDate("13/01/2024")).toThrow();
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
  });
});

const LEDGER_CSV = [
  "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo",
  'check,10482,"Bayline Electric, Inc.",12 Pier Rd,Oakland,CA,94607,2340.00,2024-08-14,false,"Invoice 1, 2"',
  "credit,,Northwind Fixtures,,,,,-150.25,2024-01-02,false,",
  "check,10483,Acme,,,,,50.00,2024-01-05,true,void",
].join("\n");

describe("parseCsv (synthetic ledger preset)", () => {
  it("parses quoted commas, optional blanks, booleans and cents", () => {
    const r = parseCsv(LEDGER_CSV, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.errors).toEqual([]);
    expect(r.headerErrors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      kind: "check",
      number: "10482",
      payeeName: "Bayline Electric, Inc.",
      amount: 234000,
      issueDate: "2024-08-14",
      voided: false,
      memo: "Invoice 1, 2",
    });
    expect(r.rows[1]).toMatchObject({ kind: "credit", amount: -15025 });
    expect(r.rows[1]!.number).toBeUndefined();
    expect(r.rows[2]!.voided).toBe(true);
    expect(r.raws[0]!["payee_name"]).toBe("Bayline Electric, Inc.");
  });

  it("handles a BOM and CRLF line endings", () => {
    const text = "﻿" + LEDGER_CSV.replace(/\n/g, "\r\n") + "\r\n";
    const r = parseCsv(text, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.headerErrors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(readHeaders(text)[0]).toBe("kind");
  });

  it("matches headers case/whitespace-insensitively", () => {
    const m: ColumnMapping = { columns: { checkNumber: "CHECK  number", amount: " Amount ", clearedDate: "cleared DATE" }, types: { amount: "amount", clearedDate: "date" } };
    const r = parseCsv("check number,AMOUNT,Cleared Date\n1,$5.00,3/4/2024", m, ClearRowSchema);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({ checkNumber: "1", amount: 500, clearedDate: "2024-03-04" });
  });

  it("reports missing required headers up front and returns no rows", () => {
    const r = parseCsv("kind,payee_name,amount\ncheck,A,1.00", syntheticLedgerMapping, LedgerRowSchema);
    expect(r.rows).toEqual([]);
    expect(r.headerErrors).toEqual(['Missing column "issue_date" (for issueDate)']);
  });

  it("reports unmapped required fields", () => {
    const m: ColumnMapping = { columns: { amount: "amount" }, required: ["amount", "issueDate"] };
    const r = parseCsv("amount\n1", m, LedgerRowSchema);
    expect(r.headerErrors).toContain("No column mapped for required field issueDate");
  });

  it("reports bad amounts and dates with 1-based row numbers and keeps good rows", () => {
    const text = [
      "kind,number,payee_name,amount,issue_date",
      "check,1,Good Co,10.00,2024-01-01",
      "check,2,Bad Amount,ten dollars,2024-01-01",
      "check,3,Bad Date,10.00,2024-13-45",
      "check,4,,10.00,2024-01-01",
      "check,5,Also Good,5,2024-01-02",
    ].join("\n");
    const r = parseCsv(text, syntheticLedgerMapping, LedgerRowSchema);
    expect(r.rows.map((x) => x.number)).toEqual(["1", "5"]);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([
      [2, "amount"],
      [3, "issueDate"],
      [4, "payeeName"],
    ]);
    expect(r.errors[0]!.raw).toMatchObject({ payee_name: "Bad Amount" });
    expect(r.errors[2]!.message).toMatch(/required/);
  });

  it("rejects rows with too many cells instead of dropping them silently", () => {
    const r = parseCsv("kind,payee_name,amount,issue_date\ncheck,A,1.00,2024-01-01,extra", syntheticLedgerMapping, LedgerRowSchema);
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 1 });
  });

  it("pads short rows and lets the schema decide", () => {
    const r = parseCsv("kind,payee_name,amount,issue_date\ncheck,A,1.00", syntheticLedgerMapping, LedgerRowSchema);
    expect(r.errors[0]).toMatchObject({ row: 1, field: "issueDate" });
  });

  it("reports empty input and malformed quoting", () => {
    expect(parseCsv("", syntheticLedgerMapping, LedgerRowSchema).headerErrors).toEqual(["CSV is empty"]);
    const bad = parseCsv('a,b\n"unterminated,1', syntheticLedgerMapping, LedgerRowSchema);
    expect(bad.headerErrors[0]).toMatch(/Could not read CSV/);
  });

  it("runs custom transforms in preference to built-in types", () => {
    const m: ColumnMapping = {
      columns: { checkNumber: "n", amount: "a", clearedDate: "d" },
      types: { amount: "amount", clearedDate: "date" },
      transforms: { amount: (raw) => Math.round(Number(raw) * 100) },
    };
    const r = parseCsv("n,a,d\n7,1.5,2024-01-01", m, ClearRowSchema);
    expect(r.rows[0]!.amount).toBe(150);
  });
});

describe("parseCsv (synthetic clears preset)", () => {
  it("parses clears with and without check numbers", () => {
    const text = "check_number,amount,cleared_date,description\n10482,2340.00,2024-09-01,CHECK 10482\n,19.99,2024-09-02,DEPOSIT ADJ";
    const r = parseCsv(text, syntheticClearsMapping, ClearRowSchema);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ checkNumber: "10482", amount: 234000 });
    expect(r.rows[1]!.checkNumber).toBeUndefined();
  });
});

describe("suggestMapping", () => {
  it("maps real-world ledger headers", () => {
    const m = suggestMapping(["Chk No", "Vendor", "Check Amount", "Date Issued", "Memo", "Void"], "ledger");
    expect(m.columns).toMatchObject({
      number: "Chk No",
      payeeName: "Vendor",
      amount: "Check Amount",
      issueDate: "Date Issued",
      memo: "Memo",
      voided: "Void",
    });
    expect(m.types).toMatchObject({ amount: "amount", issueDate: "date", voided: "boolean" });
  });

  it("handles 'Check #', 'Payee', 'Amount', 'Date'", () => {
    const m = suggestMapping(["Check #", "Payee", "Amount", "Date"], "ledger");
    expect(m.columns).toMatchObject({ number: "Check #", payeeName: "Payee", amount: "Amount", issueDate: "Date" });
  });

  it("uses each header at most once", () => {
    const m = suggestMapping(["Date", "Amount", "Payee"], "clears");
    expect(m.columns.clearedDate).toBe("Date");
    expect(Object.values(m.columns).filter((h) => h === "Date")).toHaveLength(1);
  });

  it("maps bank clear headers", () => {
    const m = suggestMapping(["Date Cleared", "Check Number", "Amount", "Description"], "clears");
    expect(m.columns).toEqual({
      checkNumber: "Check Number",
      amount: "Amount",
      clearedDate: "Date Cleared",
      description: "Description",
    });
  });

  it("omits fields with no plausible header, and the result parses end to end", () => {
    const m = suggestMapping(["Foo", "Bar"], "ledger");
    expect(m.columns).toEqual({});
    const m2 = suggestMapping(["Vendor", "Amt", "Check Date"], "ledger");
    const r = parseCsv("Vendor,Amt,Check Date\nAcme,\"$1,000.00\",1/5/24", m2, LedgerRowSchema);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ payeeName: "Acme", amount: 100000, issueDate: "2024-01-05" });
  });
});
