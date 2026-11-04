import { describe, expect, it } from "vitest";
import { buildProofChain, LINK_KINDS, type ItemFacts, type ProofLink } from "./proof-chain";

const TODAY = "2026-11-01";

function facts(over: Partial<ItemFacts> = {}): ItemFacts {
  return {
    staleItemId: "item-1",
    status: "dd_pending",
    amountCents: 125_000,
    ownerState: "DE",
    ownerStateBasis: "address",
    ledger: { referenceNumber: "10001", issueDate: "2021-01-05", amountCents: 125_000, source: "synthetic", status: "outstanding" },
    recon: { standing: "outstanding" },
    rule: { version: "2026.10.1", dependsOnUnverified: false, sources: [{ title: "12 Del. C. 1148", url: "https://delcode.delaware.gov/x" }] },
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
}

const byKind = (chain: ProofLink[], kind: ProofLink["kind"]) => chain.find((l) => l.kind === kind)!;

describe("buildProofChain", () => {
  it("returns the nine links in chain order", () => {
    expect(buildProofChain(facts(), TODAY).map((l) => l.kind)).toEqual([...LINK_KINDS]);
  });

  it("an unsent letter inside an open window is missing, with a Fix link to Approvals", () => {
    const dd = byKind(buildProofChain(facts(), TODAY), "dd_letter");
    expect(dd.status).toBe("missing");
    expect(dd.evidence).toMatch(/Window is open/);
    expect(dd.fix?.href).toBe("/approvals?kind=letter&state=DE");
  });

  it("a window that has not opened is not_yet_due, and so is the owner response", () => {
    const chain = buildProofChain(facts({ ddWindowStart: "2027-01-01", ddWindowEnd: "2027-04-01" }), TODAY);
    expect(byKind(chain, "dd_letter").status).toBe("not_yet_due");
    expect(byKind(chain, "dd_letter").fix).toBeNull();
    expect(byKind(chain, "owner_response").status).toBe("not_yet_due");
  });

  it("a letter sent inside the window is proven; outside it is missing", () => {
    const sent = (sentOn: string) => [{ channel: "letter" as const, status: "sent", sentOn, outreachId: "o1" }];
    expect(byKind(buildProofChain(facts({ notices: sent("2026-10-15") }), TODAY), "dd_letter").status).toBe("proven");
    const late = byKind(buildProofChain(facts({ notices: sent("2026-09-01") }), TODAY), "dd_letter");
    expect(late.status).toBe("missing");
    expect(late.evidence).toMatch(/outside the window/);
  });

  it("an UNVERIFIED rule is pink (missing) with a Fix link to the state's rules and is never proven", () => {
    const rule = byKind(buildProofChain(facts({ rule: { version: "2026.10.1-draft", dependsOnUnverified: true, sources: [] } }), TODAY), "rule");
    expect(rule.status).toBe("missing");
    expect(rule.status).not.toBe("proven");
    expect(rule.unverified).toBe(true);
    expect(rule.evidence).toMatch(/^Rule UNVERIFIED/);
    expect(rule.fix?.href).toBe("/rules?state=DE");
  });

  it("a verified rule is proven and carries its sources", () => {
    const rule = byKind(buildProofChain(facts(), TODAY), "rule");
    expect(rule.status).toBe("proven");
    expect(rule.sources[0]?.url).toContain("delcode");
  });

  it("due diligence the engine says does not apply is not_required for the letter and the reply", () => {
    const chain = buildProofChain(facts({ ddApplies: false, ddWindowStart: null, ddWindowEnd: null }), TODAY);
    expect(byKind(chain, "dd_letter").status).toBe("not_required");
    expect(byKind(chain, "owner_response").status).toBe("not_required");
  });

  it("unknown applicability (a rule value is missing) is missing and points at the rules", () => {
    const dd = byKind(buildProofChain(facts({ ddApplies: null }), TODAY), "dd_letter");
    expect(dd.status).toBe("missing");
    expect(dd.fix?.href).toBe("/rules?state=DE");
  });

  it("a cleared check breaks the bank link", () => {
    const bank = byKind(buildProofChain(facts({ recon: { standing: "matched" } }), TODAY), "bank");
    expect(bank.status).toBe("missing");
    expect(bank.fix?.href).toBe("/items?item=item-1");
  });

  it("an overdue unfiled report is missing and opens the close-out runner", () => {
    const chain = buildProofChain(facts({ status: "to_report", reportDue: "2026-07-01", remitDue: "2026-07-01" }), TODAY);
    for (const kind of ["naupa_line", "replica", "remittance"] as const) {
      expect(byKind(chain, kind).status).toBe("missing");
      expect(byKind(chain, kind).fix?.href).toBe("/close-out/DE");
    }
  });

  it("a filed, confirmed and remitted item proves the last three links", () => {
    const chain = buildProofChain(
      facts({
        status: "remitted",
        notices: [{ channel: "letter", status: "delivered", sentOn: "2026-10-02", outreachId: "o1" }],
        filed: { reportId: "r1234567-x", stage: "annual", checksum: "abcdef0123456789", confirmation: "REPL-DE-1", submittedOn: "2026-10-20" },
        remittance: { remittedOn: "2026-10-25", reference: "WIRE-1", by: "Dana", approvalId: "a1234567", approvedOn: "2026-10-25" },
      }),
      TODAY,
    );
    expect(byKind(chain, "naupa_line").status).toBe("proven");
    expect(byKind(chain, "replica").evidence).toContain("REPL-DE-1");
    expect(byKind(chain, "remittance").status).toBe("proven");
    expect(chain.every((l) => l.status !== "proven" || l.fix === null)).toBe(true);
  });

  it("a paid owner needs no report, confirmation or remittance", () => {
    const chain = buildProofChain(facts({ status: "resolved_paid", ownerResponse: { intent: "send_money", on: "2026-10-10" } }), TODAY);
    expect(byKind(chain, "owner_response").status).toBe("proven");
    expect(["naupa_line", "replica", "remittance"].map((k) => byKind(chain, k as ProofLink["kind"]).status)).toEqual(["not_required", "not_required", "not_required"]);
  });

  it("only missing links carry a Fix link", () => {
    for (const l of buildProofChain(facts(), TODAY)) expect(Boolean(l.fix)).toBe(l.status === "missing");
  });
});
