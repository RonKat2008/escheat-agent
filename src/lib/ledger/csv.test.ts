import { describe, expect, it } from "vitest";
import { decimal, JE_CSV_HEADER, journalCsv } from "./csv";
import { buildJournal } from "./journal";
import { allMovements } from "./movements";
import { item } from "./test-items";

const items = [
  item({ state: "TX", amountCents: 77_374, status: "remitted", classification: { remittance: { reportId: "r", remittedOn: "2026-11-01", reference: "=HYPERLINK(1)" } } }),
  item({ state: "CA", propertyType: "customer_credit", amountCents: 5 }),
];
const csv = journalCsv(buildJournal(allMovements(items, [], "2026-11-01")).entries);
const rows = csv.trimEnd().split("\r\n");
const toCents = (s: string) => (s === "" ? 0 : Math.round(Number(s) * 100));

describe("journal CSV", () => {
  it("has the import columns and one row per JE line", () => {
    expect(rows[0]).toBe(JE_CSV_HEADER.join(","));
    expect(JE_CSV_HEADER).toEqual(["Date", "JE#", "Account", "Debit", "Credit", "Memo", "Ref"]);
    expect(rows).toHaveLength(1 + 6);
    expect(rows[1]).toMatch(/^2026-\d{2}-\d{2},JE-001,/);
  });

  it("balances: the debit column equals the credit column", () => {
    const body = rows.slice(1).map((r) => r.split(","));
    expect(body.reduce((a, c) => a + toCents(c[3]!), 0)).toBe(body.reduce((a, c) => a + toCents(c[4]!), 0));
    expect(csv).toContain("2400-TX Unclaimed property payable (TX),773.74,");
  });

  it("guards a formula-looking reference", () => {
    expect(csv).toContain("'=HYPERLINK(1)");
  });

  it("formats integer cents as plain decimals", () => {
    expect(decimal(0)).toBe("");
    expect(decimal(5)).toBe("0.05");
    expect(decimal(123_456_789)).toBe("1234567.89");
  });
});
