import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { ledgerItems, outreach, payees, staleItems, type StaleItem } from "@/db/schema";
import { seedItem, TEST_SECRET } from "@/lib/outreach/testing";
import { loadOutreach, outreachContentSha256 } from "@/lib/outreach/util";

let t: TestDb;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));
// Never reach the model: the LLM layer reports "not configured", so the template fallback is used.
vi.mock("@/lib/agents/letter-writer", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/letter-writer")>()),
  draftLetterVariables: async () => {
    const { AnthropicNotConfigured } = await import("@/lib/llm/errors");
    throw new AnthropicNotConfigured();
  },
}));

import { POST as bulkDraftPost } from "./bulk-draft/route";
import { POST as bulkApprovePost } from "./bulk-approve/route";
import { POST as composeAllPost } from "./compose-all/route";

let base: Awaited<ReturnType<typeof seedItem>>;

beforeAll(async () => {
  t = await createTestDb();
  // The first company created is the app's default company, which the routes use.
  base = await seedItem(t.db, { ownerState: "CA", ref: "RT0" });
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

function env() {
  vi.stubEnv("OWNER_LINK_SECRET", TEST_SECRET);
  vi.stubEnv("APP_BASE_URL", "https://escheat.test");
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("LOB_TEST_API_KEY", "");
}

async function addItem(opts: { ref: string; ownerState?: string; ddWindowStart?: string; status?: StaleItem["status"] }) {
  const companyId = base.company.id;
  const [payee] = await t.db
    .insert(payees)
    .values({ companyId, canonicalName: `Payee ${opts.ref}`, addressLine: "1 Main St", city: "San Francisco", state: "CA", zip: "94105" })
    .returning();
  const [ledger] = await t.db
    .insert(ledgerItems)
    .values({ companyId, payeeId: payee!.id, payeeNameRaw: `Payee ${opts.ref}`, propertyType: "vendor_check", referenceNumber: opts.ref, amountCents: 10000, issueDate: "2025-08-01" })
    .returning();
  const [stale] = await t.db
    .insert(staleItems)
    .values({
      companyId,
      ledgerItemId: ledger!.id,
      ownerPayeeId: payee!.id,
      amountCents: 10000,
      propertyType: "vendor_check",
      ownerState: opts.ownerState ?? "CA",
      status: opts.status ?? "dd_pending",
      staleSince: "2026-02-01",
      ddWindowStart: opts.ddWindowStart ?? null,
    })
    .returning();
  return stale!;
}

const post = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });

describe("bulk-draft route", () => {
  it("dryRun (body flag or ?dryRun=1) returns the plan and writes nothing", async () => {
    env();
    const ok = await addItem({ ref: "RD1" });
    const tx = await addItem({ ref: "RD2", ownerState: "TX" });
    const far = await addItem({ ref: "RD3", ddWindowStart: "2030-05-02" });
    const staleItemIds = [ok.id, tx.id, far.id];

    for (const req of [post("http://x/bulk-draft", { staleItemIds, dryRun: true }), post("http://x/bulk-draft?dryRun=1", { staleItemIds })]) {
      const res = await bulkDraftPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.dryRun).toBe(true);
      expect(json.summary).toEqual({ total: 3, willDraft: 1, skipped: 2, byReason: { rule_unknown: 1, window_not_open: 1 } });
      expect(json.plan[0]).toEqual({ staleItemId: ok.id, decision: "will_draft" });
      expect(json.plan[1]).toMatchObject({ decision: "skip", code: "rule_unknown", detail: { rule: "dueDiligence.requiredLanguage", state: "TX" } });
      expect(json.plan[2]).toMatchObject({ decision: "skip", code: "window_not_open", detail: { opensOn: "2030-05-02" } });
    }
    for (const id of staleItemIds) expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, id))).toHaveLength(0);
  });

  it("a real run drafts only will_draft items and reports skip codes", async () => {
    env();
    const ok = await addItem({ ref: "RR1" });
    const tx = await addItem({ ref: "RR2", ownerState: "TX" });
    const res = await bulkDraftPost(post("http://x/bulk-draft", { staleItemIds: [ok.id, tx.id] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toEqual({ drafted: 1, skipped: 1, failed: 0, skippedByReason: { rule_unknown: 1 } });
    expect(json.results[1]).toMatchObject({ status: "skipped", code: "rule_unknown" });
    expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, tx.id))).toHaveLength(0);
  });

  it("validates the body (400)", async () => {
    expect((await bulkDraftPost(new Request("http://x", { method: "POST", body: "nope" }))).status).toBe(400);
    expect((await bulkDraftPost(post("http://x", { staleItemIds: [] }))).status).toBe(400);
  });
});

describe("compose-all and bulk-approve routes", () => {
  it("composes uncomposed drafts, returns readiness and hashes, and bulk-approve explains what is blocked", async () => {
    env();
    const good = await addItem({ ref: "CA1" });
    const tx = await addItem({ ref: "CA2", ownerState: "TX" });
    const rows = await t.db
      .insert(outreach)
      .values([good.id, tx.id].map((staleItemId) => ({ companyId: base.company.id, staleItemId, channel: "letter" as const, status: "draft" as const })))
      .returning();

    const res = await composeAllPost(post("http://x/compose-all", { outreachIds: rows.map((r) => r.id) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // `combined`: letters folded into an owner's single notice (none here: two different owners).
    expect(json.summary).toEqual({ composed: 2, ready: 1, blocked: 1, failed: 0, remaining: 0, combined: 0 });
    const goodRes = json.results.find((r: { staleItemId: string }) => r.staleItemId === good.id);
    const txRes = json.results.find((r: { staleItemId: string }) => r.staleItemId === tx.id);
    expect(goodRes).toMatchObject({ status: "composed", ready: true, problems: [] });
    expect(goodRes.contentSha256).toBe(outreachContentSha256(await loadOutreach(t.db, goodRes.outreachId)));
    expect(txRes).toMatchObject({ status: "composed", ready: false });

    const approve = await bulkApprovePost(
      post("http://x/bulk-approve", {
        channel: "letter",
        approvedBy: "ronit",
        items: [
          { outreachId: goodRes.outreachId, expectedContentSha256: goodRes.contentSha256 },
          { outreachId: txRes.outreachId, expectedContentSha256: txRes.contentSha256 },
        ],
      }),
    );
    expect(approve.status).toBe(200);
    const a = await approve.json();
    expect(a.summary).toEqual({ approved: 1, failed: 1 });
    expect(a.results[0]).toMatchObject({ ok: true });
    expect(a.results[1]).toMatchObject({ ok: false, code: "not_ready", blockedReason: expect.stringMatching(/^Blocked: .*TX is UNKNOWN/) });
    expect((await loadOutreach(t.db, txRes.outreachId)).approvalId).toBeNull();
  });

  it("compose-all accepts an empty body and rejects bad JSON", async () => {
    env();
    expect((await composeAllPost(new Request("http://x", { method: "POST" }))).status).toBe(200);
    expect((await composeAllPost(new Request("http://x", { method: "POST", body: "nope" }))).status).toBe(400);
  });
});
