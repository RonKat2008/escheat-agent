import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BANNER } from "@/lib/reports/evidence-pack";
import { pdfPageTexts } from "@/lib/reports/__fixtures__/pdf";
import { BINDER_DISCLAIMER, buildAuditBinder, type BinderInput, type BinderItem } from "./binder";
import { buildProofChain, type ItemFacts } from "./proof-chain";
import { itemReadiness, readiness } from "./score";

const TODAY = "2026-11-01";

function item(n: number, over: Partial<ItemFacts> = {}): BinderItem {
  const facts: ItemFacts = {
    staleItemId: `item-${n}`,
    status: "dd_pending",
    amountCents: 10_000 * n,
    ownerState: "DE",
    ownerStateBasis: "incorporation",
    ledger: { referenceNumber: `100${n}`, issueDate: "2021-01-05", amountCents: 10_000 * n, source: "synthetic", status: "outstanding" },
    recon: { standing: "outstanding" },
    rule: {
      version: "2026.10.1-draft",
      dependsOnUnverified: true,
      sources: [
        { title: "12 Del. C. § 1148 “notice”", url: "https://delcode.delaware.gov/title12/c011/sc02/index.html" },
        { title: "Delaware Holder Handbook", url: "https://unclaimedproperty.delaware.gov/docs/DE_Holder_Handbook.pdf#page=57" },
      ],
    },
    ddApplies: true,
    ddWindowStart: "2026-10-01",
    ddWindowEnd: "2026-12-31",
    notices: [],
    ownerResponse: null,
    reportDue: "2027-03-01",
    remitDue: "2027-03-01",
    filed: null,
    remittance: null,
    ...over,
  };
  const chain = buildProofChain(facts, TODAY);
  return { id: facts.staleItemId, payeeName: `Synthetic Payee ${n}`, amountCents: facts.amountCents, status: facts.status, referenceNumber: `100${n}`, chain, score: itemReadiness(chain) };
}

function input(items: BinderItem[]): BinderInput {
  return { state: "DE", today: TODAY, seed: "ab".repeat(32), populationCount: 11, all: false, ruleVersion: "2026.10.1-draft", score: readiness(items.map((i) => i.chain)), items };
}

describe("buildAuditBinder", () => {
  it("opens with a cover, then has exactly one page per sampled item, each with the banner and disclaimer", async () => {
    const items = [1, 2, 3].map((n) => item(n));
    const bytes = await buildAuditBinder(input(items));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
    const [cover, ...pages] = await pdfPageTexts(bytes);
    expect(pages).toHaveLength(3);
    expect(cover).toContain("COVER");
    expect(cover).toContain("Readiness");
    expect(cover).toContain("Seed sha256");
    expect(cover).toContain("Open actions");
    expect(cover).toContain("1 action: verify the DE rules");
    expect((cover!.match(/verify the DE rules/g) ?? []).length).toBe(1);
    pages.forEach((text, i) => {
      expect(text).toContain(BANNER);
      expect(text).toContain(BINDER_DISCLAIMER);
      expect(text).toContain(`ITEM ${i + 1} OF 3`);
      expect(text).toContain(`Synthetic Payee ${i + 1}`);
    });
  });

  it("prints every link with its status, UNVERIFIED marker, sources and fix", async () => {
    const [, page] = await pdfPageTexts(await buildAuditBinder(input([item(1)])));
    for (const label of ["Ledger record", "Not cleared at the bank", "Owner state + basis", "Rule version + source", "Due-diligence letter", "Owner response", "Line in the NAUPA file", "Replica confirmation", "Remittance"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("RULES GAP  |  UNVERIFIED");
    expect(page).toContain("Rule UNVERIFIED");
    expect(page).toContain("https://delcode.delaware.gov/title12/c011/sc02/index.html");
    expect(page).toContain("§ 1148"); // WinAnsi keeps the section sign
    expect(page).toContain("Fix: Verify DE rules (/rules?state=DE)");
    expect(page).toContain("seed sha256 abababababababab");
  });

  it("an empty sample still yields one page saying so", async () => {
    const bytes = await buildAuditBinder(input([]));
    const pages = await pdfPageTexts(bytes);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("No DE items to sample");
  });
});
