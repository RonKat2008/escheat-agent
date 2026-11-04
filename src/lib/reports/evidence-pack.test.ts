import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { allVerified, buildInput, ITEMS, loadFile } from "./__fixtures__";
import { pdfPageTexts, pdfTextRuns } from "./__fixtures__/pdf";
import { buildEvidencePack, pdfSafe, type EvidenceFiling, type EvidenceItem } from "./evidence-pack";
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

  describe("R5-12: filing facts, legal symbols, header layout", () => {
    const FILING: EvidenceFiling = {
      portal: "Replica TX holder portal",
      confirmation: "REPL-TX-2026-6P546S",
      checksum: "a".repeat(64),
      approvedBy: "Dana Controller",
      approvedAt: "2026-11-04T00:55:10.000Z",
      submittedAt: "2026-11-04T00:56:54.437Z",
      reportDue: { date: "2026-07-01", unverified: true },
      daysLate: 123,
      interest: { status: "ok", cents: 2607, verified: false, ruleVersion: "2026.10.0-draft" },
      remitDue: { date: "2026-07-01", unverified: true },
    };

    async function txPack(filing: EvidenceFiling | null) {
      const rules = loadFile("TX");
      const report = buildNaupaReport(buildInput("TX", "annual"));
      const items: EvidenceItem[] = [
        { item: ITEMS[0]!, timeline: null, outreach: [{ channel: "letter", at: "2026-09-01", status: "sent", summary: "Mailed to the Comptroller’s office (§ 74.707) — “final notice”" }], ownerResponses: [] },
      ];
      return buildEvidencePack({ report, items, ruleFiles: [rules], generatedAt: new Date("2026-11-04T00:56:54.437Z"), asOf: "2026-11-01", filing });
    }

    it("carries the replica confirmation, approver, lateness and interest, with UNVERIFIED where unverified", async () => {
      const pack = await txPack(FILING);
      const cover = (await pdfPageTexts(pack.bytes))[0]!;
      expect(cover).toContain("Filing");
      expect(cover).toContain("Replica confirmation: REPL-TX-2026-6P546S");
      expect(cover).toContain("Replica TX holder portal");
      expect(cover).toContain("Approved by: Dana Controller on Nov 4, 2026 00:55 UTC");
      expect(cover).toContain(`Approved file sha256: ${"a".repeat(64)}`);
      expect(cover).toContain("Submitted: Nov 4, 2026 00:56 UTC (system clock)");
      expect(cover).toMatch(/Report due: Jul 1, 2026 {2}\[UNVERIFIED\]; filed 123 days late \(as of the demo date, Nov 1, 2026\)/);
      expect(cover).toMatch(/Late interest disclosed: ~\$26\.07 accruing, from the rule file \(rules 2026\.10\.0-draft\) {2}\[UNVERIFIED\]/);
      expect(cover).toContain("As of (demo date): Nov 1, 2026");
      expect(cover).toContain("Remittance: not recorded yet.");
      const paid = (await pdfPageTexts((await txPack({ ...FILING, remittance: { remittedOn: "2026-11-01", reference: "WIRE-778", by: "Dana Controller", itemCount: 2, totalCents: 234784 } })).bytes))[0]!;
      expect(paid.replace(/\n/g, " ")).toContain("Remittance recorded: $2,347.84 for 2 item(s) on Nov 1, 2026, reference WIRE-778, recorded by Dana Controller");
      // No raw ISO timestamps on the cover.
      expect(cover).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
      const unfiled = await txPack(null);
      expect(pack.unverifiedCount - unfiled.unverifiedCount).toBe(3);
    });

    it("verified interest is not marked, unknown interest says no rate is assumed", async () => {
      const ok = (await pdfPageTexts((await txPack({ ...FILING, interest: { status: "ok", cents: 2607, verified: true, ruleVersion: "v1" } })).bytes))[0]!;
      expect(ok).toMatch(/Late interest disclosed: ~\$26\.07 accruing, from the rule file \(rules v1\)\n/);
      const unknown = (await pdfPageTexts((await txPack({ ...FILING, interest: { status: "unknown", reason: "No interest rule" } })).bytes))[0]!;
      expect(unknown).toContain("Late interest disclosed: UNKNOWN: No interest rule. No rate is assumed.");
    });

    it("says plainly when the report is not filed yet", async () => {
      const cover = (await pdfPageTexts((await txPack(null)).bytes))[0]!;
      expect(cover).toContain("Not filed yet.");
      expect(cover).not.toContain("Replica confirmation");
    });

    it("prints § and curly quotes as themselves, never as ?", async () => {
      const all = (await pdfPageTexts((await txPack(FILING)).bytes)).join("\n");
      expect(all).toContain("Comptroller’s office (§ 74.707)");
      expect(all).toContain("“final notice”");
      expect(all).not.toMatch(/Comptroller\?s|\(\? \d/);
    });

    it("transliterates only what the font cannot draw", () => {
      const winAnsi = new Set([...Array.from({ length: 95 }, (_, i) => 0x20 + i), 0xa7, 0x2019, 0x201c, 0x201d, 0xe9, 0x2014]);
      expect(pdfSafe("§ 74.1011 Comptroller’s café — ok", winAnsi)).toBe("§ 74.1011 Comptroller’s café — ok");
      const ascii = new Set(Array.from({ length: 95 }, (_, i) => 0x20 + i));
      expect(pdfSafe("§ 74.1011 Comptroller’s café — “x” → ✓", ascii)).toBe("Sec. 74.1011 Comptroller's cafe - \"x\" -> ?");
    });

    it("the header line never overlaps the title below it", async () => {
      const [cover] = await pdfTextRuns((await txPack(FILING)).bytes);
      const runs = cover!;
      const i = runs.findIndex((r) => r.text === "Filing Evidence Pack");
      const above = runs[i - 1]!;
      expect(above.text).toBe("Escheat Agent");
      const title = runs[i]!;
      // Title cap height (~0.72 em) must stay below the header's descender (~0.22 em).
      expect(title.y + title.size * 0.72).toBeLessThan(above.y - above.size * 0.22);
      // And no two consecutive left-aligned lines on any page overlap.
      for (const page of await pdfTextRuns((await txPack(FILING)).bytes)) {
        const body = page.filter((r) => r.y > 40 && r.y < 760);
        for (let k = 1; k < body.length; k++) {
          const a = body[k - 1]!;
          const b = body[k]!;
          if (b.y < a.y) expect(b.y + b.size * 0.72, `${a.text} / ${b.text}`).toBeLessThanOrEqual(a.y - a.size * 0.22 + 0.01);
        }
      }
    });
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
