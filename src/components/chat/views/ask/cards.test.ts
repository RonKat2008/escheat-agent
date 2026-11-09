import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GettingStartedUi, ImportCardUi, IntegrationsCardUi, OverdueUi, UiPayload } from "@/lib/chat/ui-types";
import { integrationRows } from "@/lib/ask/cards/data";
import { gettingStartedSteps } from "@/lib/ask/cards/data";
import { followUpsFor } from "../../followups";
import { ViewRenderer } from "../registry";

const SENTINEL = "sk-SENTINEL-must-never-render-0123456789";

const importUi: ImportCardUi = { kind: "import_card", props: { companyId: "00000000-0000-4000-8000-000000000001", fileKind: "ledger", ledgerRows: 0, asOf: "2026-11-01" } };
const integrationsUi: IntegrationsCardUi = {
  kind: "integrations_card",
  props: { rows: integrationRows({ ANTHROPIC_API_KEY: SENTINEL, QBO_CLIENT_ID: SENTINEL }) },
};
const overdueUi: OverdueUi = {
  kind: "overdue",
  props: {
    asOf: "2026-11-01",
    overdue: [
      {
        itemId: "i1",
        checkNumber: "10087",
        payeeName: "Ravenhill Cabinetry",
        state: "CA",
        amountCents: 219470,
        obligation: "Report due",
        date: "2026-10-01",
        daysLate: 31,
        verified: false,
        href: "/items?item=i1",
      },
    ],
    overdueCount: 3,
    overdueCents: 500000,
    unknownCount: 2,
    approvals: [{ key: "letter:o1", kind: "letter", title: "Letter to Ravenhill Cabinetry", subtitle: "CA · $2,194.70", href: "/approvals?sel=letter%3Ao1" }],
    approvalsCount: 1,
  },
};
const startedUi: GettingStartedUi = {
  kind: "getting_started",
  props: (() => {
    const steps = gettingStartedSteps({ ledgerRows: 0, unverifiedRules: 92, ruleStates: 3, approvedLetters: 0, filedReports: 0 });
    return { steps, doneCount: 0, total: steps.length };
  })(),
};

const render = (ui: UiPayload) => renderToStaticMarkup(createElement(ViewRenderer, { ui }));

afterEach(() => vi.restoreAllMocks());

describe("Ask action cards render from the registry", () => {
  it("mounting any card makes no request (every POST is a person's click)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("no network in tests")));
    for (const ui of [importUi, integrationsUi, overdueUi, startedUi]) expect(render(ui).length).toBeGreaterThan(100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the upload card starts at the file picker: nothing to import until a file is chosen", () => {
    const html = render(importUi);
    expect(html).toContain('data-testid="view-import-card"');
    expect(html).toContain('data-testid="import-file"');
    expect(html).toContain("Nothing is stored until you click Import.");
    expect(html).not.toContain('data-testid="import-confirm"');
  });

  it("the upload card is honest when no company is loaded", () => {
    expect(render({ ...importUi, props: { ...importUi.props, companyId: null } })).toContain("No company is loaded");
  });

  it("the integrations card shows env var NAMES and 'Not configured', never a value", () => {
    const html = render(integrationsUi);
    expect(html).not.toContain(SENTINEL);
    expect(html).toContain("QBO_CLIENT_SECRET");
    expect(html).toContain("PLAID_CLIENT_ID");
    expect(html).toContain("Not configured");
    expect(html).toContain("pnpm run doctor");
    expect(html).toContain(".env.local");
    // No connect buttons and no key entry.
    expect(html).not.toMatch(/<input|<form|Connect QuickBooks|Connect Plaid/);
  });

  it("the 'what needs you' card links each item to where a person acts, and never approves inline", () => {
    const html = render(overdueUi);
    expect(html).toContain('href="/items?item=i1"');
    expect(html).toContain('href="/approvals?sel=letter%3Ao1"');
    expect(html).toContain("31 days late");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("+2 more in Items.");
    expect(html).not.toMatch(/>Approve</);
  });

  it("getting started lists the four steps with coral links to their pages", () => {
    const html = render(startedUi);
    expect((html.match(/data-testid="getting-started-step"/g) ?? []).length).toBe(4);
    expect(html).toContain('href="/rules"');
    expect(html).toContain("92 rule values still UNVERIFIED");
    expect(html).toContain("0 of 4 steps done");
  });
});

describe("follow-up chips after a card", () => {
  it("point at the next setup step and never at approving or sending", () => {
    expect(followUpsFor([startedUi], [])).toEqual(["Upload a ledger CSV", "Set up integrations"]);
    expect(followUpsFor([integrationsUi], [])).toEqual(["Get started", "Upload a ledger CSV"]);
    expect(followUpsFor([overdueUi], [])).toEqual(["Close out California for this cycle", "Get started"]);
    for (const ui of [importUi, integrationsUi, overdueUi, startedUi]) {
      for (const q of followUpsFor([ui], [], { offline: true })) expect(q).not.toMatch(/\b(approve|send|file|submit)\b/i);
    }
  });
});
