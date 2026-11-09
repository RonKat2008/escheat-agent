import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { companies } from "@/db/schema";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import type { ChatToolContext } from "@/lib/chat/tools";
import { gettingStartedSteps, integrationRows, type OnboardingCounts } from "./data";
import { cardAnswerText } from "./answer";
import { executeAskCardTool } from "./tools";

/** A value that must never leave the server: if it shows up anywhere in a card's output, a secret leaked. */
const SENTINEL = "sk-SENTINEL-must-never-render-0123456789";

let t: TestDb;
let ctx: ChatToolContext;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  ctx = { db: t.db, companyId: (await insertFixture(t.db, STANDARD_ITEMS)).companyId };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("integrations card never leaks a value (sentinel)", () => {
  it("integrationRows reads presence only: names and states, never the value", () => {
    const rows = integrationRows({ ANTHROPIC_API_KEY: SENTINEL, QBO_CLIENT_ID: SENTINEL, QBO_CLIENT_SECRET: "", PLAID_SECRET: "   " });
    expect(JSON.stringify(rows)).not.toContain(SENTINEL);
    expect(rows.find((r) => r.id === "anthropic")).toMatchObject({ state: "configured", missing: [] });
    expect(rows.find((r) => r.id === "qbo")).toMatchObject({ state: "partial", missing: ["QBO_CLIENT_SECRET", "QBO_REDIRECT_URI"] });
    // Whitespace is not a value.
    expect(rows.find((r) => r.id === "plaid")).toMatchObject({ state: "not configured", missing: ["PLAID_CLIENT_ID", "PLAID_SECRET"] });
  });

  it("lists every optional integration the brief names", () => {
    expect(integrationRows({}).map((r) => r.id)).toEqual(["anthropic", "lob", "agentmail", "vapi", "qbo", "plaid", "inngest", "neon", "browserbase"]);
    expect(integrationRows({}).every((r) => r.state === "not configured" && r.missing.length > 0)).toBe(true);
  });

  it("the get_integrations tool output (ui, data, summary) and its answer sentence carry no value", async () => {
    for (const name of ["ANTHROPIC_API_KEY", "LOB_TEST_API_KEY", "AGENTMAIL_API_KEY", "VAPI_API_KEY", "QBO_CLIENT_SECRET", "PLAID_SECRET", "INNGEST_SIGNING_KEY", "DATABASE_URL", "BROWSERBASE_API_KEY"]) {
      vi.stubEnv(name, SENTINEL);
    }
    const r = await executeAskCardTool("get_integrations", {}, ctx);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
    expect(r.ui.kind).toBe("integrations_card");
    if (r.ok) expect(cardAnswerText([{ name: "get_integrations", ok: true, summary: r.summary, data: r.data }])).not.toContain(SENTINEL);
  });
});

describe("card tools", () => {
  it("start_import puts companyId in ui only, never in the model data", async () => {
    const r = await executeAskCardTool("start_import", { kind: "clears" }, ctx);
    expect(r).toMatchObject({ ok: true, ui: { kind: "import_card", props: { companyId: ctx.companyId, fileKind: "clears", asOf: "2026-11-01" } } });
    expect(JSON.stringify(r.ok ? r.data : null)).not.toContain(ctx.companyId);
    expect(r.ok && r.ui.kind === "import_card" && r.ui.props.ledgerRows).toBeGreaterThan(0);
  });

  it("start_import validates its input at the boundary", async () => {
    const r = await executeAskCardTool("start_import", { kind: "payroll" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/Invalid input for start_import/);
    expect((await executeAskCardTool("approve_everything", {}, ctx)).ok).toBe(false);
  });

  it("list_overdue returns real rows with coral targets; ids stay out of the model data", async () => {
    const r = await executeAskCardTool("list_overdue", {}, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok || r.ui.kind !== "overdue") throw new Error("expected an overdue card");
    const p = r.ui.props;
    expect(p.asOf).toBe("2026-11-01");
    expect(p.overdue.length).toBeLessThanOrEqual(p.overdueCount);
    for (const o of p.overdue) {
      expect(o.href).toBe(`/items?item=${o.itemId}`);
      expect(o.daysLate).toBeGreaterThan(0);
      expect(JSON.stringify(r.data)).not.toContain(o.itemId);
    }
    for (const a of p.approvals) expect(a.href).toMatch(/^\/approvals\?sel=/);
    expect(JSON.stringify(r.data)).not.toContain(ctx.companyId);
  });

  it("get_started reflects real state, and only sees the caller's company", async () => {
    const [other] = await t.db.insert(companies).values({ name: "Other Co (SYNTHETIC)", incorporationState: "DE" }).returning();
    const own = await executeAskCardTool("get_started", {}, ctx);
    const foreign = await executeAskCardTool("get_started", {}, { db: t.db, companyId: other!.id });
    if (!own.ok || own.ui.kind !== "getting_started" || !foreign.ok || foreign.ui.kind !== "getting_started") throw new Error("expected checklists");
    expect(own.ui.props.steps.find((s) => s.id === "data")?.done).toBe(true);
    expect(foreign.ui.props.steps.find((s) => s.id === "data")?.done).toBe(false);
    expect(own.ui.props.total).toBe(4);
  });
});

describe("gettingStartedSteps", () => {
  const none: OnboardingCounts = { ledgerRows: 0, unverifiedRules: 92, ruleStates: 3, approvedLetters: 0, filedReports: 0 };

  it("nothing done: every step is open, data links to the upload card", () => {
    const steps = gettingStartedSteps(none);
    expect(steps.map((s) => s.id)).toEqual(["data", "rules", "letter", "filing"]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[0]).toMatchObject({ askPrompt: "Upload a ledger CSV", href: "/settings/integrations" });
    expect(steps[1]!.detail).toContain("92 rule values still UNVERIFIED across 3 states");
  });

  it("each step is done only from real counts", () => {
    const steps = gettingStartedSteps({ ledgerRows: 733, unverifiedRules: 0, ruleStates: 3, approvedLetters: 1, filedReports: 2 });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps[0]!.detail).toBe("733 ledger rows loaded.");
    expect(steps[3]!.detail).toBe("2 reports filed with a replica state portal.");
    // No rule files loaded is never "reviewed".
    expect(gettingStartedSteps({ ...none, unverifiedRules: 0, ruleStates: 0 })[1]!.done).toBe(false);
  });
});

describe("cardAnswerText", () => {
  it("says what the card lets the person do, and never that something happened", () => {
    const text = cardAnswerText([
      { name: "start_import", ok: true, summary: "", data: { kind: "ledger" } },
      { name: "list_overdue", ok: true, summary: "", data: { overdue: { count: 2 }, approvalsWaiting: 1 } },
      { name: "get_started", ok: true, summary: "", data: { steps: [{ step: "Load your ledger", done: true }, { step: "Review the rules", done: false }] } },
    ]);
    expect(text).toContain("Nothing is stored until you do.");
    expect(text).toContain("2 items are past a deadline and 1 thing waits for your approval");
    expect(text).toContain("1 of 2 setup steps done. Next: review the rules.");
    expect(text).not.toMatch(/\b(was|were|has been|have been) (imported|approved|sent|filed)\b/i);
    expect(text).not.toMatch(/^(Imported|Approved|Sent|Filed)\b/m);
  });
});
