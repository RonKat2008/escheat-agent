import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach } from "@/db/schema";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { seedItem, TEST_SECRET } from "@/lib/outreach/testing";
import type { UiKind } from "../ui-types";
import { anthropicToolDefinitions, CHAT_TOOLS, executeChatTool, type ChatToolContext } from "./index";

let t: TestDb;
let ctx: ChatToolContext;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("OWNER_LINK_SECRET", TEST_SECRET);
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  t = await createTestDb();
  const f = await insertFixture(t.db, STANDARD_ITEMS);
  ctx = { db: t.db, companyId: f.companyId };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

async function ok(name: string, input: unknown = {}) {
  const r = await executeChatTool(name, input, ctx);
  if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
  return r;
}

describe("chat tool definitions", () => {
  it("exposes a fixed set of tools with object JSON schemas and no approve/send/file tool", () => {
    const defs = anthropicToolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(CHAT_TOOLS.map((x) => x.name));
    for (const d of defs) {
      expect(d.input_schema.type).toBe("object");
      expect(d.input_schema).not.toHaveProperty("$schema");
      expect(d.name).not.toMatch(/approve|send|submit|file_report|consume|mail|call_owner/);
    }
  });

  it("rejects invalid input before running anything", async () => {
    const bad = await executeChatTool("upcoming_deadlines", { days: 9999 }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.ui.kind).toBe("error");
    const badState = await executeChatTool("get_exposure", { state: "California" }, ctx);
    expect(badState.ok).toBe(false);
    const unknown = await executeChatTool("approve_everything", {}, ctx);
    expect(unknown).toMatchObject({ ok: false, error: 'Unknown tool "approve_everything".' });
    const badClock = await executeChatTool("advance_clock", { days: 0 }, ctx);
    expect(badClock.ok).toBe(false);
  });
});

describe("chat tools return data for the model and a typed UI payload", () => {
  const cases: [string, unknown, UiKind][] = [
    ["get_exposure", {}, "exposure"],
    ["get_exposure", { state: "ca" }, "exposure"],
    ["list_stale_items", { state: "CA" }, "items"],
    ["list_stale_items", { min_amount_dollars: 500 }, "items"],
    ["explain_item", { item: "#10482" }, "item_timeline"],
    ["upcoming_deadlines", { days: 120 }, "deadlines"],
    ["get_audit_interest_exposure", {}, "interest"],
    ["list_pending_approvals", {}, "approvals"],
    ["list_rules", {}, "rules"],
    ["list_reports", {}, "reports"],
    ["list_recoveries", {}, "recoveries"],
    ["list_agent_runs", {}, "runs"],
    ["get_clock", {}, "clock"],
    ["open_view", { view: "items", item: "#10482" }, "link"],
  ];
  it.each(cases)("%s %j -> %s", async (name, input, kind) => {
    const r = await ok(name, input);
    expect(r.ui.kind).toBe(kind);
    expect(JSON.stringify(r.data).length).toBeLessThan(13_000);
  });

  it("get_exposure matches the read model (open items only)", async () => {
    const r = await ok("get_exposure");
    const data = r.data as { itemCount: number; total: string; byState: { state: string }[] };
    expect(data.itemCount).toBe(4); // resolved_paid and remitted are closed
    expect(data.total).toBe("$3,100.50");
    if (r.ui.kind !== "exposure") throw new Error("kind");
    expect(r.ui.props.exposure.totalCents).toBe(234000 + 50000 + 25050 + 1000);
  });

  it("list_stale_items applies the dollar filter", async () => {
    const r = await ok("list_stale_items", { min_amount_dollars: 500 });
    const data = r.data as { total: number; items: { check: string }[] };
    expect(data.items.map((i) => i.check)).toEqual(["10482", "20001"]);
    expect(data.total).toBe(2);
  });

  it("explain_item flags UNKNOWN/UNVERIFIED instead of inventing dates", async () => {
    const r = await ok("explain_item", { item: "10482" });
    const data = r.data as { timeline: { flag: string | null; verified: boolean; status: string }[] };
    for (const e of data.timeline) {
      if (e.status === "UNKNOWN") expect(e.flag).toBe("UNKNOWN");
      else if (!e.verified) expect(e.flag).toBe("UNVERIFIED");
    }
    const missing = await executeChatTool("explain_item", { item: "99999999" }, ctx);
    expect(missing.ok).toBe(false);
  });

  it("open_view builds safe in-app links only", async () => {
    const r = await ok("open_view", { view: "reports", state: "tx" });
    expect(r.ui).toEqual({ kind: "link", props: expect.objectContaining({ href: "/reports?state=TX" }) });
    expect((await executeChatTool("open_view", { view: "https://evil.example" }, ctx)).ok).toBe(false);
  });

  it("advance_clock moves the demo date and reports what changed; refused outside demo mode", async () => {
    const r = await ok("advance_clock", { days: 30 });
    if (r.ui.kind !== "clock") throw new Error("kind");
    expect(r.ui.props.today).toBe("2026-12-01");
    expect(r.ui.props.change?.from).toBe("2026-11-01");
    vi.stubEnv("DEMO_MODE", "0");
    vi.stubEnv("NODE_ENV", "production");
    const refused = await executeChatTool("advance_clock", { days: 30 }, ctx);
    expect(refused.ok).toBe(false);
  });

  it("generate_report reports honestly when nothing is To Report", async () => {
    const r = await executeChatTool("generate_report", { state: "CA" }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/To Report/);
  });
});

describe("drafting never approves or sends", () => {
  it("create_outreach_draft writes one draft row, no approval, and returns an approval card", async () => {
    const t2 = await createTestDb();
    try {
      const s = await seedItem(t2.db, { ref: "77001" });
      const c2: ChatToolContext = { db: t2.db, companyId: s.company.id };
      const r = await executeChatTool("create_outreach_draft", { item: "77001", channel: "voice" }, c2);
      if (!r.ok) throw new Error(r.error);
      expect(r.ui.kind).toBe("approval_card");
      if (r.ui.kind !== "approval_card") return;
      expect(r.ui.props.status).toBe("draft");
      expect(r.ui.props.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.ui.props.reviewUrl).toContain("/approvals?sel=o%3A");
      expect(r.data).toMatchObject({ sent: false, approvedByTool: false });
      // Idempotent: the same draft comes back.
      const again = await executeChatTool("create_outreach_draft", { item: "77001", channel: "voice" }, c2);
      if (!again.ok || again.ui.kind !== "approval_card") throw new Error("second draft failed");
      expect(again.ui.props.outreachId).toBe(r.ui.props.outreachId);
      expect(again.ui.props.created).toBe(false);
      const rows = await t2.db.select().from(outreach);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("draft");
      expect(rows[0]!.approvalId).toBeNull();
      expect(rows[0]!.sentAt).toBeNull();
      expect(await t2.db.select().from(approvals)).toHaveLength(0);
    } finally {
      await t2.close();
    }
  });

  it("running every non-launching tool creates no approval row", async () => {
    for (const tool of CHAT_TOOLS) {
      if (tool.name === "start_recovery_search") continue; // launches a browser; covered by the static check below
      await executeChatTool(tool.name, tool.name === "explain_item" || tool.name === "create_outreach_draft" ? { item: "10482" } : tool.name === "open_view" ? { view: "dashboard" } : tool.name === "advance_clock" ? { days: 400 } : tool.name === "get_agent_run" ? { run_id: "00000000-0000-4000-8000-000000000000" } : tool.name === "generate_report" ? { state: "CA" } : {}, ctx);
    }
    expect(await t.db.select().from(approvals)).toHaveLength(0);
    const sent = (await t.db.select().from(outreach)).filter((o) => o.sentAt !== null || o.approvalId !== null);
    expect(sent).toHaveLength(0);
  });

  it("no chat module imports an approve, consume or send function", () => {
    const dir = path.join(process.cwd(), "src/lib/chat");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    const forbidden = /\b(approve|approveOutreach|approveReport|approveClaim|approveRuleField|approveRuleFile|consumeApproval|withApproval|sendOutreach|sendLetter|sendEmail|placeCall|launchFilingAgent|launchClaimFiling)\b/;
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      const imports = src.split("\n").filter((l) => /^\s*(import|export)\b.*from\s/.test(l) || /^\s*[A-Za-z_,\s{}]*\}\s*from\s/.test(l));
      const importBlocks = src.match(/import\s*\{[^}]*\}\s*from\s*"[^"]+"/g) ?? [];
      for (const line of [...imports, ...importBlocks]) expect(`${f}: ${line}`).not.toMatch(forbidden);
    }
  });
});
