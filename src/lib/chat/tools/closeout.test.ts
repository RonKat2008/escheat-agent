import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach, reports } from "@/db/schema";
import { buildClosePlan } from "@/lib/close-out/plan";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { CHAT_TOOLS, executeChatTool, type ChatToolContext } from "./index";

let t: TestDb;
let ctx: ChatToolContext;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  t = await createTestDb();
  const f = await insertFixture(t.db, [
    ...STANDARD_ITEMS,
    { key: "tr", check: "20002", payee: "Alamo Steel", cents: 40_000, issueDate: "2024-01-01", state: "TX", status: "to_report", remit: "2026-11-30" },
  ]);
  ctx = { db: t.db, companyId: f.companyId };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("plan_close_out tool", () => {
  it("is registered as a read-only tool", () => {
    const tool = CHAT_TOOLS.find((x) => x.name === "plan_close_out");
    expect(tool).toBeDefined();
    expect(tool!.writes).toBe(false);
    expect(tool!.description).toMatch(/approves, sends, files and pays nothing/);
  });

  it("renders the close_plan card with exactly the plan built in code", async () => {
    const r = await executeChatTool("plan_close_out", { state: "tx" }, ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.ui.kind).toBe("close_plan");
    if (r.ui.kind !== "close_plan") return;
    expect(r.ui.props.plan).toEqual(await buildClosePlan(t.db, ctx.companyId, "TX"));
    expect(r.ui.props.plan.steps).toHaveLength(8);
    expect(r.summary).toBe(`TX close-out: ${r.ui.props.plan.done} of 8 done`);
  });

  it("gives the model a compact, formatted summary and no ids", async () => {
    const r = await executeChatTool("plan_close_out", { state: "TX" }, ctx);
    if (!r.ok) throw new Error(r.error);
    const data = r.data as { state: string; atStake: string; steps: { step: string; status: string; amount: string | null }[]; next: { step: string } | null; approvedOrSentByTool: boolean };
    expect(data.state).toBe("TX");
    expect(data.atStake).toBe("$900.00"); // dd_pending $500 + to_report $400; remitted and other states excluded
    expect(data.steps.map((s) => s.status)).toEqual(expect.arrayContaining(["ready"]));
    expect(data.next).not.toBeNull();
    expect(data.approvedOrSentByTool).toBe(false);
    expect(JSON.stringify(data)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(JSON.stringify(data)).not.toContain("href");
  });

  it("refuses an unsupported state with a clear message", async () => {
    const r = await executeChatTool("plan_close_out", { state: "NY" }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'Close-out plans cover CA, DE and TX only, not "NY".', ui: { kind: "error" } });
    expect((await executeChatTool("plan_close_out", {}, ctx)).ok).toBe(false);
  });

  it("writes nothing", async () => {
    await executeChatTool("plan_close_out", { state: "CA" }, ctx);
    await executeChatTool("plan_close_out", { state: "TX" }, ctx);
    expect(await t.db.select().from(outreach)).toHaveLength(0);
    expect(await t.db.select().from(reports)).toHaveLength(0);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });
});
