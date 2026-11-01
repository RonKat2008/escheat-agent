import { describe, expect, it } from "vitest";
import { csvCell, csvRow, toCsv } from "./csv";

describe("csvCell", () => {
  it("passes plain text through and renders null/undefined as empty", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes commas, quotes and newlines, doubling embedded quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it.each(["=SUM(A1)", "+1+1", "-2", "@cmd", "\tx"])("prefixes formula-leading cell %j with an apostrophe", (v) => {
    expect(csvCell(v).startsWith("'") || csvCell(v).startsWith(`"'`)).toBe(true);
    expect(csvCell(v)).toContain(`'${v}`);
  });

  it("guards first, then quotes when the guarded value needs it", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("does not guard formula characters that are not leading", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("x-y")).toBe("x-y");
  });

  it("serializes dates as ISO strings", () => {
    expect(csvCell(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("toCsv", () => {
  it("joins with CRLF and ends with a trailing CRLF", () => {
    expect(csvRow(["a", "b,c"])).toBe('a,"b,c"');
    expect(toCsv(["h1", "h2"], [["1", "=2"], ["3", null]])).toBe("h1,h2\r\n1,'=2\r\n3,\r\n");
  });
});
