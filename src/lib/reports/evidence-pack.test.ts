import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { allVerified, buildInput, ITEMS, loadFile } from "./__fixtures__";
import { pdfPageTexts } from "./__fixtures__/pdf";
import { buildEvidencePack, type EvidenceItem } from "./evidence-pack";
import { buildNaupaReport } from "./naupa";
import { computeTimeline } from "../rules/engine";
import type { IsoDate } from "../dates";

const textOf = async (bytes: Uint8Array) => (await pdfPageTexts(bytes)).join("\n");
const FIXED = new Date("2026-10-29T12:00:00Z");

function evidence(rules = loadFile("CA")): EvidenceItem[] {
  return ITEMS.slice(0, 2).map((item, i) => ({
    item,
    timeline: computeTimeline(
      { propertyType: item.propertyType, lastActivityDate: item.lastActivityDate as IsoDate, amountCents: item.amountCents, ownerState: "CA" },
      rules,
    ),
    outreach: i === 0 ? [{ channel: "letter", at: "2026-09-01", status: "mailed (test mode)", lobLetterId: "ltr_test_123", lobUrl: "https://lob.example.test/ltr_test_123.pdf" }, { channel: "email", at: "2026-09-01", status: "sent", emailId: "email_abc", to: "owner@example.test" }] : [],
    ownerResponses: i === 0 ? [{ at: "2026-09-05", channel: "email", summary: "Owner confirmed address." }] : [],
  }));
}

describe("buildEvidencePack", () => {
  it("has cover + one page per item + appendix, banner, sha256, and UNVERIFIED markers", async () => {
    const rules = loadFile("CA");
    const report = buildNaupaReport(buildInput("CA", "remit"));
    const pack = await buildEvidencePack({ report, items: evidence(rules), ruleFiles: [rules], generatedAt: FIXED });
    const doc = await PDFDocument.load(pack.bytes);
    const pages = await pdfPageTexts(pack.bytes);
    expect(pages).toHaveLength(doc.getPageCount());
    expect(pack.pageCount).toBe(pages.length);
    expect(pages[0]).toContain("Filing Evidence Pack");
    // Each item starts on a fresh page (a long timeline may continue onto the next one); the appendix is last.
    const idx = (needle: string) => pages.findIndex((p) => p.includes(needle));
    expect(idx("Item 1 of 2")).toBe(1);
    expect(idx("Item 2 of 2")).toBeGreaterThan(1);
    expect(idx("Appendix: rule values used")).toBeGreaterThan(idx("Item 2 of 2"));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const p of pages) expect(p).toContain("NOT LEGAL ADVICE");
    expect(pack.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(pack.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pack.unverifiedCount).toBeGreaterThan(0);
    const all = pages.join("\n");
    for (const needle of ["UNVERIFIED", "PROTOTYPE", "SYNTHETIC", "ltr_test_123", "email_abc", "https://lob.example.test/ltr_test_123.pdf", "leginfo.legislature.ca.gov", "2026.10.0-draft", "Northwind Fixtures, Inc.", "$2,613.50"]) {
      expect(all, needle).toContain(needle);
    }
    expect(all).toContain("Owner confirmed address.");
    expect(all).toContain("[UNVERIFIED]");
  });

  it("is reproducible for fixed inputs and changes when the input changes", async () => {
    const rules = loadFile("CA");
    const report = buildNaupaReport(buildInput("CA", "remit"));
    const a = await buildEvidencePack({ report, items: evidence(rules), ruleFiles: [rules], generatedAt: FIXED });
    const b = await buildEvidencePack({ report, items: evidence(rules), ruleFiles: [rules], generatedAt: FIXED });
    expect(a.sha256).toBe(b.sha256);
    const c = await buildEvidencePack({ report, items: evidence(rules).slice(0, 1), ruleFiles: [rules], generatedAt: FIXED });
    expect(c.sha256).not.toBe(a.sha256);
    expect(c.pageCount).toBe(a.pageCount - 1);
  });

  it("omits UNVERIFIED when every rule value is verified", async () => {
    const rules = allVerified(loadFile("CA"));
    const report = buildNaupaReport(buildInput("CA", "remit", { rules }));
    const pack = await buildEvidencePack({ report, items: evidence(rules), ruleFiles: [rules], generatedAt: FIXED });
    expect(pack.unverifiedCount).toBe(0);
    const text = await textOf(pack.bytes);
    expect(text).not.toContain("UNVERIFIED");
    expect(text).toContain("[verified]");
    expect(text).toContain("PROTOTYPE");
  });

  it("grows pages instead of overflowing when an item has a long log", async () => {
    const rules = loadFile("CA");
    const report = buildNaupaReport(buildInput("CA", "remit"));
    const items = evidence(rules);
    items[0] = { ...items[0]!, outreach: Array.from({ length: 80 }, (_, i) => ({ channel: "email", at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, status: "sent", emailId: `e_${i}` })) };
    const pack = await buildEvidencePack({ report, items, ruleFiles: [rules], generatedAt: FIXED });
    expect(pack.pageCount).toBeGreaterThan(4);
  });

  it("works with no items and no timeline and says so", async () => {
    const rules = loadFile("TX");
    const report = buildNaupaReport(buildInput("TX", "annual", { items: [] }));
    const none = await buildEvidencePack({ report, items: [], ruleFiles: [rules], generatedAt: FIXED });
    expect(none.pageCount).toBeGreaterThanOrEqual(2);
    expect(await pdfPageTexts(none.bytes)).not.toContainEqual(expect.stringContaining("Item 1"));
    const noTl = await buildEvidencePack({ report, items: [{ item: ITEMS[0]!, timeline: null, outreach: [], ownerResponses: [] }], ruleFiles: [rules], generatedAt: FIXED });
    expect(await textOf(noTl.bytes)).toContain("No timeline supplied");
  });
});
