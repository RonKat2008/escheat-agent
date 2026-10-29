import { describe, expect, it } from "vitest";
import {
  aggregateCodeFor,
  compactToIso,
  decodeRecord,
  encodeField,
  encodeRecord,
  EncodeError,
  HOLDER_LAYOUT,
  isRealDate,
  LAYOUTS,
  PROPERTY_LAYOUT,
  RECORD_LENGTH,
  sanitizeAscii,
  sanitizeName,
  SUMMARY_LAYOUT,
} from "./layout";

const pos = (layout: (typeof LAYOUTS)[keyof typeof LAYOUTS], name: string) => {
  const f = layout.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return `${f.start}-${f.start + f.length - 1}`;
};

describe("layout tables", () => {
  for (const [kind, layout] of Object.entries(LAYOUTS)) {
    it(`${kind}: fields tile bytes 1..625 with no gap or overlap`, () => {
      let next = 1;
      for (const f of layout.fields) {
        expect(f.start, `${layout.kind} ${f.name}`).toBe(next);
        next += f.length;
      }
      expect(next - 1).toBe(RECORD_LENGTH);
    });
    it(`${kind}: field names are unique and the first field is TR-CODE`, () => {
      const names = layout.fields.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
      expect(layout.fields[0]).toMatchObject({ name: "TR-CODE", start: 1, length: 1, fixed: layout.trCode });
    });
  }

  it("matches spec positions (docs/naupa-format.md)", () => {
    expect(pos(HOLDER_LAYOUT, "HOLDER-NAME")).toBe("37-76");
    expect(pos(HOLDER_LAYOUT, "HOLDER-CONTACT1-EMAIL")).toBe("317-366");
    expect(pos(HOLDER_LAYOUT, "HOLDER-NAICS-CODE")).toBe("615-620");
    expect(pos(PROPERTY_LAYOUT, "PROP-OWNER-NAME-LAST")).toBe("10-49");
    expect(pos(PROPERTY_LAYOUT, "PROP-ST-TRANS-DATE")).toBe("289-296");
    expect(pos(PROPERTY_LAYOUT, "PROP-PROPERTY-TYPE")).toBe("305-308");
    expect(pos(PROPERTY_LAYOUT, "PROP-AMOUNT-REPORTED")).toBe("309-318");
    expect(pos(PROPERTY_LAYOUT, "PROP-AMOUNT-REMITTED")).toBe("365-374");
    expect(pos(PROPERTY_LAYOUT, "PROP-CHECK-NUMBER")).toBe("531-550");
    expect(pos(PROPERTY_LAYOUT, "PROP-OWNER-TYPE-CODE")).toBe("603-604");
    expect(pos(SUMMARY_LAYOUT, "SUMM-AMOUNT-REPORTED")).toBe("14-25");
    expect(pos(SUMMARY_LAYOUT, "SUMM-CREATOR-CONTACT")).toBe("183-252");
  });
});

describe("encoding helpers", () => {
  const alpha = PROPERTY_LAYOUT.fields.find((f) => f.name === "PROP-OWNER-NAME-LAST")!;
  const num = PROPERTY_LAYOUT.fields.find((f) => f.name === "PROP-AMOUNT-REPORTED")!;
  const date = PROPERTY_LAYOUT.fields.find((f) => f.name === "PROP-ST-TRANS-DATE")!;

  it("alpha is left-justified, space padded, uppercased", () => {
    const { text } = encodeField(alpha, "acme");
    expect(text).toBe("ACME".padEnd(40, " "));
  });
  it("numeric is right-justified, zero padded", () => {
    expect(encodeField(num, 25300).text).toBe("0000025300");
    expect(encodeField(num, null).text).toBe("0000000000");
  });
  it("numeric rejects overflow and non-digits", () => {
    expect(() => encodeField(num, 12345678901)).toThrow(EncodeError);
    expect(() => encodeField(num, -5)).toThrow(EncodeError);
    expect(() => encodeField(num, "12.50")).toThrow(EncodeError);
  });
  it("dates encode as CCYYMMDD and reject impossible dates", () => {
    expect(encodeField(date, "2024-02-29").text).toBe("20240229");
    expect(() => encodeField(date, "2023-02-29")).toThrow(EncodeError);
    expect(encodeField(date, null).text).toBe("00000000");
  });
  it("alpha truncates and reports it", () => {
    const r = encodeField(alpha, "x".repeat(60));
    expect(r.text).toHaveLength(40);
    expect(r.truncated).toBe(true);
  });
  it("sanitizers strip non-ASCII, fold accents, and name charset drops punctuation", () => {
    expect(sanitizeAscii("José Müller ☃ 株式会社")).toBe("JOSE MULLER");
    expect(sanitizeName("O'Brien & Sons, Inc.")).toBe("OBRIEN & SONS INC");
  });
  it("isRealDate / compactToIso", () => {
    expect(isRealDate("20240229")).toBe(true);
    expect(isRealDate("20230229")).toBe(false);
    expect(isRealDate("00000000")).toBe(false);
    expect(compactToIso("20240131")).toBe("2024-01-31");
    expect(compactToIso("00000000")).toBeNull();
  });
  it("aggregateCodeFor maps only spec families", () => {
    expect(aggregateCodeFor("CK13")).toBe("CK99");
    expect(aggregateCodeFor("MS04")).toBe("MS99");
    expect(aggregateCodeFor("ZZ01")).toBeNull();
  });
  it("encode/decode round trip on a record", () => {
    const r = encodeRecord(PROPERTY_LAYOUT, { "PROP-SEQUENCE-NUMBER": 7, "PROP-OWNER-NAME-LAST": "Test", "PROP-AMOUNT-REPORTED": 99 });
    expect(r.line).toHaveLength(RECORD_LENGTH);
    expect(decodeRecord(PROPERTY_LAYOUT, r.line)).toEqual(r.fields);
  });
});
