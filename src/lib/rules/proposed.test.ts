import { describe, expect, it } from "vitest";
import type { RuleSource } from "../../../rules/schema";
import { loadRules } from "./load";
import { declaredText, isOfficialSourceUrl, proposedValue } from "./proposed";
import { describeRuleStatus } from "./unknown-copy";
import { listRuleValues } from "./values";

const TX_TEXT =
  "(1) You (the holder) are holding the property; and (2) You (the holder) may be required to deliver the property to the Comptroller’s office on or before July 1 if the property is not claimed.";

const src = (url: string, quote: string): RuleSource => ({ url, title: "T", quote, retrieved_at: "2026-10-29" });
const envelope = (sources: RuleSource[], value: unknown = null) => ({ value, sources, verified: false });

describe("proposedValue (R3-05)", () => {
  it("extracts the Comptroller's declared notice language from the REAL TX rule file, verbatim", () => {
    const tx = loadRules("TX").file.dueDiligence.requiredLanguage;
    expect(tx.value).toBeNull();
    const p = proposedValue(tx);
    expect(p.confidence).toBe("verbatim_quote");
    expect(p.proposed).toBe(TX_TEXT);
    expect(p.sources[0]?.url).toBe("https://claimittexas.gov/docs/96-478.pdf#page=13");
    expect(p.quote).toBe(p.sources[0]?.quote);
    expect(p.quote!.endsWith(p.proposed!)).toBe(true);
    // Never the researcher's note.
    expect(tx.todo && p.proposed && tx.todo.includes(p.proposed)).toBeFalsy();
  });

  it("is deterministic and proposes nothing for any TX field that already has a value", () => {
    const tx = loadRules("TX").file;
    expect(proposedValue(tx.dueDiligence.requiredLanguage)).toEqual(proposedValue(tx.dueDiligence.requiredLanguage));
    for (const v of listRuleValues(tx).filter((x) => x.rv.value !== null)) expect(proposedValue(v.rv)).toMatchObject({ confidence: "none", reason: "has_value" });
  });

  it("refuses when no source has a quote", () => {
    expect(proposedValue(envelope([src("https://claimittexas.gov/x.pdf", "")]))).toEqual({
      proposed: null,
      quote: null,
      sources: [],
      confidence: "none",
      reason: "no_quote",
    });
    expect(proposedValue(envelope([]))).toMatchObject({ confidence: "none", reason: "no_quote" });
  });

  it("refuses when the declaring quote is not from an official source", () => {
    const quote = "The notice must include the following language: We are holding your property.";
    expect(proposedValue(envelope([src("https://unclaimed.org/guide", quote)]))).toMatchObject({ confidence: "none", reason: "no_official_source" });
    expect(proposedValue(envelope([src("http://comptroller.texas.gov/x", quote)]))).toMatchObject({ reason: "no_official_source" });
    expect(proposedValue(envelope([src("https://evil.gov.example.com/x", quote)]))).toMatchObject({ reason: "no_official_source" });
  });

  it("refuses when official quotes only describe the content (no declared verbatim text)", () => {
    const statute = "(1) the holder is holding the property; and (2) the holder may be required to deliver the property";
    expect(proposedValue(envelope([src("https://tcss.legis.texas.gov/PR.74.htm", statute)]))).toMatchObject({ confidence: "none", reason: "no_declared_text" });
    expect(proposedValue(envelope([src("https://x.gov/a", "The notice must include the following language:   ")]))).toMatchObject({ reason: "no_declared_text" });
  });

  it("skips an unofficial declaring source and uses the official one; collects official corroboration", () => {
    const p = proposedValue(
      envelope([
        src("https://unclaimed.org/a", "Holders shall include the following language: Something else."),
        src("https://sco.ca.gov/b", "Each notice shall contain the following statement: Exact words."),
        src("https://leginfo.legislature.ca.gov/c", "... Exact words. ..."),
      ]),
    );
    expect(p).toMatchObject({ proposed: "Exact words.", confidence: "verbatim_quote" });
    expect(p.sources.map((s) => s.url)).toEqual(["https://sco.ca.gov/b", "https://leginfo.legislature.ca.gov/c"]);
  });

  it("official-source and declaration helpers", () => {
    expect(isOfficialSourceUrl("https://www.sco.ca.gov/x")).toBe(true);
    expect(isOfficialSourceUrl("https://cpa.state.tx.us/x")).toBe(true);
    expect(isOfficialSourceUrl("not a url")).toBe(false);
    expect(declaredText("no declaration here")).toBeNull();
  });
});

describe("describeRuleStatus (plain-language copy)", () => {
  it("TX required language: no developer text, names the official source, awaits approval", () => {
    const tx = loadRules("TX").file.dueDiligence.requiredLanguage;
    const c = describeRuleStatus("TX", "dueDiligence.requiredLanguage", tx);
    expect(c.kind).toBe("official_text_found");
    expect(c.text).toMatch(/^Texas notice wording not yet confirmed; official text found at .+ \(claimittexas\.gov\), awaiting human approval\.$/);
    expect(c.text).not.toMatch(/src\/|\.test\.ts|null|TODO/i);
    expect(c.source?.url).toBe("https://claimittexas.gov/docs/96-478.pdf#page=13");
  });

  it("missing, unverified and verified values", () => {
    expect(describeRuleStatus("DE", "dueDiligence.requiredLanguage", envelope([])).kind).toBe("missing");
    expect(describeRuleStatus("CA", "propertyTypes.vendor_check.dormancyYears", envelope([], 3)).text).toBe(
      "California vendor check dormancy period has a researched value that a person has not confirmed yet.",
    );
    expect(describeRuleStatus("XX", "interest", { ...envelope([], 1), verified: true, verified_by: "Dana" }).text).toBe("XX interest on late reports confirmed by Dana.");
  });
});
