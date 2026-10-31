import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns, companies } from "@/db/schema";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { executeChatTool, type ChatToolContext } from "./index";

let t: TestDb;
let ctx: ChatToolContext;
let ownRunId: string;
let foreignRunId: string;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  t = await createTestDb();
  const f = await insertFixture(t.db, STANDARD_ITEMS);
  ctx = { db: t.db, companyId: f.companyId };
  const [other] = await t.db.insert(companies).values({ name: "Other Co (SYNTHETIC)", incorporationState: "DE" }).returning();
  const [own] = await t.db.insert(agentRuns).values({ companyId: f.companyId, agent: "chat", status: "succeeded", trace: [{}, {}] }).returning();
  const [foreign] = await t.db.insert(agentRuns).values({ companyId: other!.id, agent: "recovery-agent", status: "succeeded", trace: [{}] }).returning();
  ownRunId = own!.id;
  foreignRunId = foreign!.id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

describe("get_agent_run is scoped to the current company (L8)", () => {
  it("returns the run when it belongs to the current company", async () => {
    const r = await executeChatTool("get_agent_run", { run_id: ownRunId }, ctx);
    expect(r).toMatchObject({ ok: true, data: { agent: "chat", status: "succeeded", steps: 2 } });
  });

  it("returns a clear not-found, and no data, for another company's run", async () => {
    const r = await executeChatTool("get_agent_run", { run_id: foreignRunId }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(`No agent run ${foreignRunId}.`);
    expect(JSON.stringify(r)).not.toContain("recovery-agent");
  });

  it("returns the same not-found for an unknown run id", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    const r = await executeChatTool("get_agent_run", { run_id: unknown }, ctx);
    expect(r).toMatchObject({ ok: false, error: `No agent run ${unknown}.` });
  });
});

describe("open_view does not trust ids supplied by the model or client (L3)", () => {
  it("links an own run and an existing item", async () => {
    const run = await executeChatTool("open_view", { view: "runs", run_id: ownRunId }, ctx);
    expect(run).toMatchObject({ ok: true, data: { href: `/runs/${ownRunId}` } });
    const item = await executeChatTool("open_view", { view: "items", item: "#10482" }, ctx);
    expect(item.ok).toBe(true);
  });

  it("refuses a foreign or unknown run id instead of building a link", async () => {
    const foreign = await executeChatTool("open_view", { view: "runs", run_id: foreignRunId }, ctx);
    expect(foreign).toMatchObject({ ok: false, error: `No agent run ${foreignRunId}.` });
    const unknown = await executeChatTool("open_view", { view: "runs", run_id: "00000000-0000-4000-8000-000000000000" }, ctx);
    expect(unknown.ok).toBe(false);
  });

  it("refuses an item reference that is not one of this company's items", async () => {
    const r = await executeChatTool("open_view", { view: "items", item: "999999999" }, ctx);
    expect(r.ok).toBe(false);
  });
});
