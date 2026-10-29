import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAnthropicClient, type Citation } from "@/lib/llm/client";
import { jsonMessage, message, mockClient } from "@/lib/llm/testing";
import { enforceCitations, researchStateRules, type ModelResearch } from "./rule-research";

const now = new Date("2026-10-29T00:00:00Z");
const domains = ["sco.ca.gov", "leginfo.legislature.ca.gov"];
const cite = (url: string, citedText: string | null): Citation => ({
  url,
  title: "T",
  citedText,
  origin: citedText ? "citation" : "search_result",
});
const entry = (field: string, value: string | number | null, sources: Array<{ url: string; quote: string }>) => ({
  property_type: "vendor_check" as const,
  field: field as never,
  value,
  sources: sources.map((s) => ({ ...s, title: "T" })),
});

describe("enforceCitations", () => {
  const raw: ModelResearch = {
    fields: [
      entry("dormancy_months", 36, [{ url: "https://sco.ca.gov/a", quote: "Three Years" }]),
      entry("dd_window_days_min", 60, [{ url: "https://sco.ca.gov/never-retrieved", quote: "60 days" }]),
      entry("dd_window_days_max", 120, [{ url: "https://evil.example.com/x", quote: "120 days" }]),
      entry("min_reportable_cents", 5000, []),
      entry("naupa_code", "AC01", [{ url: "https://sco.ca.gov/a", quote: "something not in the citation" }]),
      entry("report_due_description", null, []),
    ],
  };
  const citations = [
    cite("https://sco.ca.gov/a", "property is presumed abandoned after three years"),
    cite("https://evil.example.com/x", "120 days"),
    cite("https://sco.ca.gov/b", null),
  ];
  const out = enforceCitations(raw, ["vendor_check"], citations, { allowedDomains: domains, now });
  const f = out.vendor_check!;

  it("keeps a cited value and the model quote when it appears in the citation text", () => {
    expect(f.dormancy_months.value).toBe(36);
    expect(f.dormancy_months.sources[0]?.quote).toBe("Three Years");
    expect(f.dormancy_months.sources[0]?.retrieved_at).toBe(now.toISOString());
  });
  it("replaces a quote that is not in the citation with the cited text itself", () => {
    expect(f.naupa_code.value).toBe("AC01");
    expect(f.naupa_code.sources[0]?.quote).toBe("property is presumed abandoned after three years");
  });
  it("nulls values whose source was never retrieved, is off-domain, or absent, with a todo", () => {
    for (const k of ["dd_window_days_min", "dd_window_days_max", "min_reportable_cents"] as const) {
      expect(f[k].value).toBeNull();
      expect(f[k].sources).toEqual([]);
      expect(f[k].todo).toBeTruthy();
    }
  });
  it("nulls a model-null value, forces verified=false everywhere", () => {
    expect(f.report_due_description.value).toBeNull();
    for (const v of Object.values(f)) expect(v.verified).toBe(false);
  });
  it("rejects non-numeric values for numeric fields", () => {
    const bad = enforceCitations(
      { fields: [entry("dormancy_months", "three years", [{ url: "https://sco.ca.gov/a", quote: "three" }])] },
      ["vendor_check"],
      citations,
      { allowedDomains: domains, now },
    );
    expect(bad.vendor_check?.dormancy_months.value).toBeNull();
  });
});

describe("researchStateRules", () => {
  beforeEach(() => {
    vi.stubEnv("ESCHEAT_OFFLINE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => {
    setAnthropicClient(undefined);
    vi.unstubAllEnvs();
  });

  it("two-call flow; draft is unverified, uncited values are null+todo", async () => {
    const client = mockClient([
      message([
        {
          type: "text",
          text: "Dormancy is three years.",
          citations: [
            { type: "web_search_result_location", url: "https://sco.ca.gov/a", title: "SCO", cited_text: "abandoned after three years" },
          ],
        },
      ]),
      jsonMessage({
        fields: [
          entry("dormancy_months", 36, [{ url: "https://sco.ca.gov/a", quote: "abandoned after three years" }]),
          entry("min_reportable_cents", 5000, [{ url: "https://sco.ca.gov/zzz", quote: "$50" }]),
        ],
      }),
    ]);
    setAnthropicClient(client);
    const draft = await researchStateRules("ca", ["vendor_check"], { now });
    expect(draft.verified).toBe(false);
    expect(draft.state).toBe("CA");
    const f = draft.properties.vendor_check!;
    expect(f.dormancy_months.value).toBe(36);
    expect(f.min_reportable_cents.value).toBeNull();
    expect(f.min_reportable_cents.todo).toBeTruthy();
    expect(draft.source_urls).toEqual(["https://sco.ca.gov/a"]);
    const webTool = client.calls[0]?.tools?.[0] as { allowed_domains?: string[] };
    expect(webTool.allowed_domains).toEqual(expect.arrayContaining(["sco.ca.gov", "leginfo.legislature.ca.gov", "unclaimed.org"]));
  });
});
