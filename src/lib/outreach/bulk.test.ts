import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, ledgerItems, outreach, payees, staleItems, type StaleItem } from "@/db/schema";
import { requestApprovalPayloadHash } from "@/lib/approvals";
import type { ComposeDeps } from "@/lib/letters/compose";
import { BULK_MAX, bulkApproveOutreach, bulkDraftOutreach, composeAllDrafts, draftIneligibleReason, listReadyToApprove, planBulkDraftFromDb } from "./bulk";
import { draftOutreach } from "./draft";
import { prepareSend } from "./payloads";
import { seedItem, testEnv } from "./testing";
import { loadOutreach, outreachContentSha256 } from "./util";

let t: TestDb;
const env = testEnv();
// Never reach the model: the template fallback is used.
const deps: ComposeDeps = {
  env,
  draftVariables: async () => {
    throw new Error("no model in tests");
  },
};

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

/** Another stale item in the SAME company as `base`. */
async function addItem(base: Awaited<ReturnType<typeof seedItem>>, opts: { ref: string; status?: StaleItem["status"]; ownerState?: string | null; ddWindowStart?: string; withAddress?: boolean; amountCents?: number }) {
  const companyId = base.company.id;
  const [payee] = await t.db
    .insert(payees)
    .values({ companyId, canonicalName: `Payee ${opts.ref}`, addressLine: opts.withAddress === false ? null : "1 Main St", city: opts.withAddress === false ? null : "San Francisco", state: opts.withAddress === false ? null : "CA", zip: opts.withAddress === false ? null : "94105" })
    .returning();
  const [ledger] = await t.db
    .insert(ledgerItems)
    .values({ companyId, payeeId: payee!.id, payeeNameRaw: `Payee ${opts.ref}`, propertyType: "vendor_check", referenceNumber: opts.ref, amountCents: opts.amountCents ?? 10000, issueDate: "2025-08-01" })
    .returning();
  const ownerState = opts.ownerState === undefined ? "CA" : opts.ownerState;
  const [stale] = await t.db
    .insert(staleItems)
    .values({ companyId, ledgerItemId: ledger!.id, ownerPayeeId: payee!.id, amountCents: opts.amountCents ?? 10000, propertyType: "vendor_check", ownerState, status: opts.status ?? "dd_pending", staleSince: "2026-02-01", ddWindowStart: opts.ddWindowStart ?? null })
    .returning();
  return stale!;
}

async function draftLetter(staleId: string) {
  const r = await draftOutreach(t.db, staleId, "letter", deps);
  const row = await loadOutreach(t.db, r.outreachId);
  return { id: r.outreachId, hash: outreachContentSha256(row) };
}

describe("bulkApproveOutreach", () => {
  it("records one approval per item, each with its own payload sha256, and sends nothing", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "B1" });
    const second = await addItem(base, { ref: "B2" });
    const a = await draftLetter(base.stale.id);
    const b = await draftLetter(second.id);

    const results = await bulkApproveOutreach(t.db, {
      companyId: base.company.id,
      channel: "letter",
      approvedBy: "ronit",
      env,
      items: [
        { outreachId: a.id, expectedContentSha256: a.hash },
        { outreachId: b.id, expectedContentSha256: b.hash },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const hashes = new Set<string>();
    for (const { id } of [a, b]) {
      const row = await loadOutreach(t.db, id);
      expect(row.status).toBe("approved");
      expect(row.sentAt).toBeNull();
      expect(row.providerId).toBeNull();
      const [ap] = await t.db.select().from(approvals).where(eq(approvals.id, row.approvalId!));
      expect(ap?.action).toBe("mail_letter");
      expect(ap?.subjectId).toBe(id);
      expect(ap?.approvedBy).toBe("ronit");
      const prepared = await prepareSend(t.db, row, { env });
      expect(ap?.payloadSha256).toBe(requestApprovalPayloadHash(prepared.payload));
      hashes.add(ap!.payloadSha256);
    }
    expect(hashes.size).toBe(2);
    const all = await t.db.select().from(approvals);
    expect(all.filter((x) => [a.id, b.id].includes(x.subjectId))).toHaveLength(2);
  });

  it("reports per-item results for a mixed batch and does not let one failure block others", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "M1" });
    const second = await addItem(base, { ref: "M2" });
    const good = await draftLetter(base.stale.id);
    const tampered = await draftLetter(second.id);
    const missing = crypto.randomUUID();

    const results = await bulkApproveOutreach(t.db, {
      companyId: base.company.id,
      channel: "letter",
      approvedBy: "ronit",
      env,
      items: [
        { outreachId: tampered.id, expectedContentSha256: "0".repeat(64) },
        { outreachId: missing, expectedContentSha256: good.hash },
        { outreachId: good.id, expectedContentSha256: good.hash },
      ],
    });
    expect(results[0]).toMatchObject({ ok: false, code: "reviewed_content_changed" });
    expect(results[1]).toMatchObject({ ok: false, code: "not_found" });
    expect(results[2]).toMatchObject({ ok: true });
    expect((await loadOutreach(t.db, tampered.id)).approvalId).toBeNull();
    expect((await loadOutreach(t.db, good.id)).status).toBe("approved");
  });

  it("a payload edited after the reviewer opened it fails and is not approved", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "T1" });
    const d = await draftLetter(base.stale.id);
    await t.db.update(outreach).set({ body: "<html><body>tampered</body></html>" }).where(eq(outreach.id, d.id));
    const [r] = await bulkApproveOutreach(t.db, {
      companyId: base.company.id,
      channel: "letter",
      approvedBy: "ronit",
      env,
      items: [{ outreachId: d.id, expectedContentSha256: d.hash }],
    });
    expect(r).toMatchObject({ ok: false, code: "reviewed_content_changed" });
    const row = await loadOutreach(t.db, d.id);
    expect(row.status).not.toBe("approved");
    expect(row.approvalId).toBeNull();
  });

  it("is company scoped: another company's draft is reported as not found and stays unapproved", async () => {
    const mine = await seedItem(t.db, { ownerState: "CA", ref: "C1" });
    const theirs = await seedItem(t.db, { ownerState: "CA", ref: "C2" });
    const d = await draftLetter(theirs.stale.id);
    const [r] = await bulkApproveOutreach(t.db, {
      companyId: mine.company.id,
      channel: "letter",
      approvedBy: "ronit",
      env,
      items: [{ outreachId: d.id, expectedContentSha256: d.hash }],
    });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    const row = await loadOutreach(t.db, d.id);
    expect(row.approvalId).toBeNull();
    expect(row.status).not.toBe("approved");
  });

  it("rejects a draft whose channel differs from the batch channel", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "W1" });
    const d = await draftLetter(base.stale.id);
    const [r] = await bulkApproveOutreach(t.db, {
      companyId: base.company.id,
      channel: "email",
      approvedBy: "ronit",
      env,
      items: [{ outreachId: d.id, expectedContentSha256: d.hash, to: "owner@example.com" }],
    });
    expect(r).toMatchObject({ ok: false, code: "wrong_channel" });
  });

  it("enforces the batch cap", async () => {
    const items = Array.from({ length: BULK_MAX + 1 }, () => ({ outreachId: crypto.randomUUID(), expectedContentSha256: "a".repeat(64) }));
    await expect(bulkApproveOutreach(t.db, { companyId: crypto.randomUUID(), channel: "letter", approvedBy: "r", items })).rejects.toThrow(/limited to 50/);
  });
});

describe("bulkDraftOutreach", () => {
  it("drafts eligible items and skips ineligible ones with a reason", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "D1" });
    const closed = await addItem(base, { ref: "D2", status: "resolved_paid" });
    const noState = await addItem(base, { ref: "D3", ownerState: null });
    const needsRule = await addItem(base, { ref: "D4", status: "needs_rule" });
    const already = await addItem(base, { ref: "D5" });
    await draftLetter(already.id);
    const foreign = await seedItem(t.db, { ownerState: "CA", ref: "D6" });

    const ids = [base.stale.id, closed.id, noState.id, needsRule.id, already.id, foreign.stale.id, crypto.randomUUID()];
    const results = await bulkDraftOutreach(t.db, { companyId: base.company.id, channel: "letter", staleItemIds: ids }, deps);

    expect(results.map((r) => r.staleItemId)).toEqual(ids);
    expect(results[0]).toMatchObject({ status: "drafted", ready: true });
    expect(results[1]).toMatchObject({ status: "skipped", reason: expect.stringMatching(/resolved as paid/) });
    expect(results[2]).toMatchObject({ status: "skipped", reason: expect.stringMatching(/state is unknown/) });
    expect(results[3]).toMatchObject({ status: "skipped", reason: expect.stringMatching(/rule/) });
    expect(results[4]).toMatchObject({ status: "skipped", reason: expect.stringMatching(/already waiting/) });
    expect(results[5]).toMatchObject({ status: "skipped", reason: "Item not found." });
    expect(results[6]).toMatchObject({ status: "skipped", reason: "Item not found." });

    const rows = await t.db.select().from(outreach).where(eq(outreach.staleItemId, base.stale.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");
    // Nothing was drafted for the skipped or foreign items.
    expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, foreign.stale.id))).toHaveLength(0);
    expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, closed.id))).toHaveLength(0);
  });

  it("enforces the batch cap", async () => {
    const ids = Array.from({ length: BULK_MAX + 1 }, () => crypto.randomUUID());
    await expect(bulkDraftOutreach(t.db, { companyId: crypto.randomUUID(), channel: "letter", staleItemIds: ids })).rejects.toThrow(/limited to 50/);
  });

  it("draftIneligibleReason covers sent/approved and to_report", () => {
    expect(draftIneligibleReason({ status: "dd_pending", ownerState: "CA" }, [{ status: "sent" }], "letter")).toMatch(/already sent/);
    expect(draftIneligibleReason({ status: "dd_pending", ownerState: "CA" }, [{ status: "approved" }], "letter")).toMatch(/already approved/);
    expect(draftIneligibleReason({ status: "to_report", ownerState: "CA" }, [], "letter")).toMatch(/report queue/);
    expect(draftIneligibleReason({ status: "dd_pending", ownerState: "CA" }, [], "letter")).toBeNull();
  });
});

describe("pre-flight, compose-all, ready list and blocked reasons", () => {
  it("dry run plans without writing: TX unknown language, far window, no address, ready item", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "P1" });
    const tx = await addItem(base, { ref: "P2", ownerState: "TX", amountCents: 30_000 }); // above TX's $250.01 notice minimum (R5-01)
    const far = await addItem(base, { ref: "P3", ddWindowStart: "2030-05-02" });
    const noAddr = await addItem(base, { ref: "P4", withAddress: false });
    const ids = [base.stale.id, tx.id, far.id, noAddr.id];
    const { plan, summary } = await planBulkDraftFromDb(t.db, { companyId: base.company.id, channel: "letter", staleItemIds: ids });
    expect(plan.map((p) => (p.decision === "skip" ? p.code : "will_draft"))).toEqual(["will_draft", "rule_unknown", "window_not_open", "missing_owner_address"]);
    expect(summary).toMatchObject({ total: 4, willDraft: 1, skipped: 3 });
    for (const id of ids) expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, id))).toHaveLength(0);
  });

  it("bulk draft creates no unapprovable drafts: TX and far-window items are skipped with codes", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "Q1" });
    const tx = await addItem(base, { ref: "Q2", ownerState: "TX", amountCents: 30_000 }); // above TX's $250.01 notice minimum (R5-01)
    const far = await addItem(base, { ref: "Q3", ddWindowStart: "2030-05-02" });
    const results = await bulkDraftOutreach(t.db, { companyId: base.company.id, channel: "letter", staleItemIds: [base.stale.id, tx.id, far.id] }, deps);
    expect(results[0]).toMatchObject({ status: "drafted", ready: true });
    expect(results[1]).toMatchObject({ status: "skipped", code: "rule_unknown", detail: { rule: "dueDiligence.requiredLanguage", state: "TX" } });
    expect(results[2]).toMatchObject({ status: "skipped", code: "window_not_open", detail: { opensOn: "2030-05-02" } });
    expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, tx.id))).toHaveLength(0);
    expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, far.id))).toHaveLength(0);
  });

  it("compose-all composes only uncomposed drafts, reports readiness, and the ready list feeds approve", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "R1" });
    const second = await addItem(base, { ref: "R2" });
    const tx = await addItem(base, { ref: "R3", ownerState: "TX" });
    // Uncomposed drafts: bare rows, as an older bulk draft or a failed compose could leave behind.
    const bare = await t.db
      .insert(outreach)
      .values([base.stale.id, second.id, tx.id].map((staleItemId) => ({ companyId: base.company.id, staleItemId, channel: "letter" as const, status: "draft" as const })))
      .returning();
    expect(await listReadyToApprove(t.db, base.company.id)).toEqual([]);

    const { results, remaining } = await composeAllDrafts(t.db, { companyId: base.company.id, channel: "letter" }, deps);
    expect(remaining).toBe(0);
    expect(results).toHaveLength(3);
    const byStale = new Map(results.map((r) => [r.staleItemId, r]));
    expect(byStale.get(base.stale.id)).toMatchObject({ status: "composed", ready: true });
    expect(byStale.get(second.id)).toMatchObject({ status: "composed", ready: true });
    const txRes = byStale.get(tx.id)!;
    expect(txRes).toMatchObject({ status: "composed", ready: false });
    if (txRes.status === "composed") expect(txRes.problems.join(" ")).toMatch(/TX is UNKNOWN/);

    // Already composed drafts are not composed again.
    expect((await composeAllDrafts(t.db, { companyId: base.company.id, channel: "letter" }, deps)).results).toHaveLength(0);

    const ready = await listReadyToApprove(t.db, base.company.id, "letter");
    expect(ready.map((r) => r.staleItemId).sort()).toEqual([base.stale.id, second.id].sort());
    expect(bare.length).toBe(3);

    // The listed hash is the one approve accepts; approved drafts leave the ready list.
    const [r] = await bulkApproveOutreach(t.db, {
      companyId: base.company.id,
      channel: "letter",
      approvedBy: "ronit",
      env,
      items: [{ outreachId: ready[0]!.outreachId, expectedContentSha256: ready[0]!.contentSha256 }],
    });
    expect(r).toMatchObject({ ok: true });
    expect((await listReadyToApprove(t.db, base.company.id, "letter")).map((x) => x.outreachId)).not.toContain(ready[0]!.outreachId);
  });

  it("compose-all is company scoped and honours outreachIds", async () => {
    const mine = await seedItem(t.db, { ownerState: "CA", ref: "S1" });
    const theirs = await seedItem(t.db, { ownerState: "CA", ref: "S2" });
    const [a] = await t.db.insert(outreach).values({ companyId: theirs.company.id, staleItemId: theirs.stale.id, channel: "letter", status: "draft" }).returning();
    const out = await composeAllDrafts(t.db, { companyId: mine.company.id, channel: "letter", outreachIds: [a!.id] }, deps);
    expect(out.results).toHaveLength(0);
    expect((await loadOutreach(t.db, a!.id)).body).toBeNull();
  });

  it("bulk approve gives every blocked draft an inline reason and still refuses to approve it", async () => {
    const base = await seedItem(t.db, { ownerState: "TX", ref: "T1" });
    const notComposed = await addItem(base, { ref: "T2" });
    const txDraft = await draftLetter(base.stale.id);
    const [bare] = await t.db.insert(outreach).values({ companyId: base.company.id, staleItemId: notComposed.id, channel: "letter", status: "draft" }).returning();
    const [rTx, rBare] = await bulkApproveOutreach(t.db, {
      companyId: base.company.id,
      channel: "letter",
      approvedBy: "ronit",
      env,
      items: [
        { outreachId: txDraft.id, expectedContentSha256: txDraft.hash },
        { outreachId: bare!.id, expectedContentSha256: "a".repeat(64) },
      ],
    });
    expect(rTx).toMatchObject({ ok: false, code: "not_ready", problems: [expect.stringMatching(/TX is UNKNOWN/)], blockedReason: expect.stringMatching(/^Blocked: .*TX is UNKNOWN/) });
    expect(rBare).toMatchObject({ ok: false, blockedReason: expect.stringMatching(/not composed yet/) });
    for (const id of [txDraft.id, bare!.id]) {
      const row = await loadOutreach(t.db, id);
      expect(row.status).not.toBe("approved");
      expect(row.approvalId).toBeNull();
    }
  });
});
