import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach, reports } from "@/db/schema";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { seedItem, TEST_SECRET } from "@/lib/outreach/testing";
import type { UiKind } from "../ui-types";
import { addressLines, approvalCard, APPROVAL_CARD_MAX_BODY_CHARS } from "./actions";
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

  it("advance_clock only proposes a date; the clock does not move until a person clicks (L2); refused outside demo mode", async () => {
    const r = await ok("advance_clock", { days: 30 });
    if (r.ui.kind !== "clock") throw new Error("kind");
    expect(r.ui.props.today).toBe("2026-11-01");
    expect(r.ui.props.proposal).toEqual({ days: 30, to: "2026-12-01" });
    expect(r.data).toMatchObject({ moved: false, proposedDate: "2026-12-01" });
    const after = await ok("get_clock");
    if (after.ui.kind !== "clock") throw new Error("kind");
    expect(after.ui.props.today).toBe("2026-11-01");
    expect(after.ui.props.offsetDays).toBe(0);
    expect(CHAT_TOOLS.find((x) => x.name === "advance_clock")?.writes).toBe(false);
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
    const forbidden = /\b(approve|approveOutreach|approveReport|approveClaim|approveRuleField|approveRuleFile|consumeApproval|withApproval|sendOutreach|sendLetter|sendEmail|placeCall|launchFilingAgent|launchClaimFiling|advanceClock|resetClock|recomputeTimelines)\b/;
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      const imports = src.split("\n").filter((l) => /^\s*(import|export)\b.*from\s/.test(l) || /^\s*[A-Za-z_,\s{}]*\}\s*from\s/.test(l));
      const importBlocks = src.match(/import\s*\{[^}]*\}\s*from\s*"[^"]+"/g) ?? [];
      for (const line of [...imports, ...importBlocks]) expect(`${f}: ${line}`).not.toMatch(forbidden);
    }
  });
});

describe("approval card shows everything the approval hash covers (M1)", () => {
  const LOB = JSON.stringify({
    name: "Bayline Electric Attn: Treasury",
    company: "Bayline Holdings",
    address_line1: "500 Market St",
    address_line2: "Suite 9",
    address_city: "San Francisco",
    address_state: "CA",
    address_zip: "94105",
    address_country: "US",
  });

  it("addressLines prints every stored field, name first, and flags fields it cannot show", () => {
    expect(addressLines(LOB)).toEqual({
      lines: ["Bayline Electric Attn: Treasury", "Bayline Holdings", "500 Market St", "Suite 9", "San Francisco, CA 94105", "US"],
      complete: true,
    });
    expect(addressLines(JSON.stringify({ name: "A", address_line1: "1 St", description: "hidden" })).complete).toBe(false);
    expect(addressLines(JSON.stringify({ name: "A", metadata: { x: 1 } })).complete).toBe(false);
    expect(addressLines("{not json").complete).toBe(false);
    expect(addressLines(null)).toEqual({ lines: [], complete: true });
  });

  async function letterDraft(body: string, toAddress: string) {
    const t2 = await createTestDb();
    const s = await seedItem(t2.db, { ref: "77002" });
    const [row] = await t2.db
      .insert(outreach)
      .values({ companyId: s.company.id, staleItemId: s.stale.id, channel: "letter", status: "draft", subject: "Notice", body, toAddress })
      .returning();
    return { t2, c2: { db: t2.db, companyId: s.company.id } as ChatToolContext, id: row!.id };
  }

  it("shows toAddress.name (not the canonical payee) and allows inline approval only when fully shown", async () => {
    const { t2, c2, id } = await letterDraft("<p>Short letter.</p>", LOB);
    try {
      const card = await approvalCard(c2, id, false);
      expect(card.toAddressLines[0]).toBe("Bayline Electric Attn: Treasury");
      expect(card.toAddressLines).toContain("Suite 9");
      expect(card.bodyTruncated).toBe(false);
      expect(card.fullyShown).toBe(true);
    } finally {
      await t2.close();
    }
  });

  it("a body longer than the card can show is never fully shown", async () => {
    const { t2, c2, id } = await letterDraft(`<p>${"x".repeat(APPROVAL_CARD_MAX_BODY_CHARS + 10)}</p>`, LOB);
    try {
      const card = await approvalCard(c2, id, false);
      expect(card.bodyTruncated).toBe(true);
      expect(card.bodyText!.length).toBe(APPROVAL_CARD_MAX_BODY_CHARS);
      expect(card.fullyShown).toBe(false);
    } finally {
      await t2.close();
    }
  });

  it("unknown address fields or unshowable markup block inline approval", async () => {
    const a = await letterDraft("<p>Hi</p>", JSON.stringify({ name: "A", address_line1: "1 St", note: "x" }));
    const b = await letterDraft('<p>Hi</p><img src="x.png">', LOB);
    try {
      expect((await approvalCard(a.c2, a.id, false)).fullyShown).toBe(false);
      expect((await approvalCard(b.c2, b.id, false)).fullyShown).toBe(false);
      const [row] = await b.t2.db.select().from(outreach).where(eq(outreach.id, b.id));
      expect(row!.approvalId).toBeNull();
    } finally {
      await a.t2.close();
      await b.t2.close();
    }
  });
});

describe("generate_report never replaces a report a person holds (M3)", () => {
  it.each(["awaiting_approval", "approved"] as const)("refuses when a CA report is %s and leaves it untouched", async (status) => {
    const [held] = await t.db
      .insert(reports)
      .values({ companyId: ctx.companyId, state: "CA", reportYear: 2026, status, itemCount: 2, totalCents: 234784 })
      .returning();
    const r = await ok("generate_report", { state: "CA" });
    expect(r.data).toMatchObject({ regenerated: false, filed: false });
    if (r.ui.kind !== "report") throw new Error("kind");
    expect(r.ui.props.reportId).toBe(held!.id);
    const expected = status === "awaiting_approval" ? `/approvals?sel=${encodeURIComponent(`r:${held!.id}`)}` : "/reports?state=CA";
    expect(r.ui.props.heldForReview?.href).toBe(expected);
    const rows = await t.db.select().from(reports).where(eq(reports.id, held!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe(status);
  });

  it("does not hold back when the only other report is a draft (the page's replace-the-draft behavior is unchanged)", async () => {
    await t.db.insert(reports).values({ companyId: ctx.companyId, state: "CA", reportYear: 2026, status: "draft" });
    const r = await executeChatTool("generate_report", { state: "CA" }, ctx);
    // Nothing is To Report in the fixture, so the service answers honestly rather than showing a held card.
    expect(r.ok).toBe(false);
  });
});
