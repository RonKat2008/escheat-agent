import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, ledgerItems, outreach, outreachItems, staleItems } from "@/db/schema";
import { ApprovalRequiredError, requestApprovalPayloadHash } from "@/lib/approvals";
import { composeLetter, composeNotice } from "@/lib/letters/compose";
import { escapeHtml } from "@/lib/letters/template";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { loadRules } from "@/lib/rules/load";
import { composeAllDrafts } from "./bulk";
import { OutreachNotReadyError } from "./errors";
import { sendLetter } from "./lob";
import { consolidateLetters, pendingConsolidation } from "./notice";
import { recordOwnerResponse } from "./owner-response";
import { prepareSend, type LetterPayload } from "./payloads";
import { approveOutreach } from "./send";
import { seedItem, TEST_SECRET, testEnv, type Seeded } from "./testing";
import { loadOutreach } from "./util";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const failing = async () => {
  throw new AnthropicNotConfigured();
};
const env = testEnv({ LOB_TEST_API_KEY: "test_abc123" });
const deps = { env, draftVariables: failing };

/** Another stale item for the SAME owner (payee) as `base`, optionally in another state. SYNTHETIC. */
async function sameOwnerItem(base: Seeded, opts: { ref: string; cents: number; issue: string; state?: string }) {
  const [ledger] = await t.db
    .insert(ledgerItems)
    .values({
      companyId: base.company.id,
      payeeId: base.ledger.payeeId,
      payeeNameRaw: "BAYLINE ELEC",
      propertyType: "vendor_check",
      referenceNumber: opts.ref,
      amountCents: opts.cents,
      issueDate: opts.issue,
    })
    .returning();
  const [stale] = await t.db
    .insert(staleItems)
    .values({
      companyId: base.company.id,
      ledgerItemId: ledger!.id,
      ownerPayeeId: base.stale.ownerPayeeId,
      amountCents: opts.cents,
      propertyType: "vendor_check",
      ownerState: opts.state ?? base.stale.ownerState,
      status: "dd_pending",
      staleSince: "2026-02-01",
    })
    .returning();
  return stale!;
}

/** Bayline-shaped owner: #10482 $2,340.00 and #10537 $3,786.71 in CA, each with its own single-item letter. */
async function twoLetters() {
  const base = await seedItem(t.db, { ownerState: "CA", ref: "10482", amountCents: 234_000 });
  const second = await sameOwnerItem(base, { ref: "10537", cents: 378_671, issue: "2025-09-15" });
  const a = await composeLetter(t.db, base.stale.id, deps);
  const b = await composeLetter(t.db, second.id, deps);
  return { base, second, a, b };
}

const letters = (companyId: string) => t.db.select().from(outreach).where(and(eq(outreach.companyId, companyId), eq(outreach.channel, "letter")));

describe("one notice per owner", () => {
  it("compose all turns two letters to one owner into ONE letter listing both checks and the total", async () => {
    const { base, a, b } = await twoLetters();
    expect(a.outreachId).not.toBe(b.outreachId);
    expect(await pendingConsolidation(t.db, base.company.id)).toHaveLength(1);

    const { results } = await composeAllDrafts(t.db, { companyId: base.company.id, channel: "letter" }, deps);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r).toMatchObject({ status: "composed", ready: true, itemCount: 2, combined: [b.outreachId] });

    const rows = await letters(base.company.id);
    const open = rows.filter((o) => o.status === "draft");
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(a.outreachId);
    const absorbed = rows.find((o) => o.id === b.outreachId)!;
    expect(absorbed.status).toBe("cancelled");
    expect(absorbed.tracking?.consolidatedInto).toBe(a.outreachId);

    const html = open[0]!.body!;
    expect(html).toContain("#10482");
    expect(html).toContain("#10537");
    expect(html).toContain("$6,126.71");
    expect(html).toContain('data-notice-items="2"');
    expect(open[0]!.subject).toBe("Due diligence notice - 2 checks");
    // Statutory text comes ONLY from the CA rule file, verbatim, once.
    const language = loadRules("CA").file.dueDiligence.requiredLanguage.value!;
    expect(html).toContain(escapeHtml(language));
    expect(html.match(/data-statutory="true"/g)).toHaveLength(1);

    const items = await t.db.select().from(outreachItems).where(eq(outreachItems.outreachId, a.outreachId));
    expect(items.map((i) => i.amountCents).sort()).toEqual([234_000, 378_671]);
    expect(await pendingConsolidation(t.db, base.company.id)).toEqual([]);
    // Settled: a second Compose all changes nothing.
    expect((await composeAllDrafts(t.db, { companyId: base.company.id, channel: "letter" }, deps)).results).toEqual([]);
  });

  it("never mixes states: the same owner in CA and DE gets two letters", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "20001" });
    const de = await sameOwnerItem(base, { ref: "20002", cents: 5_000, issue: "2025-09-15", state: "DE" });
    await composeLetter(t.db, base.stale.id, deps);
    await composeLetter(t.db, de.id, deps);
    expect(await pendingConsolidation(t.db, base.company.id)).toEqual([]);
    expect(await consolidateLetters(t.db, base.company.id, deps)).toEqual([]);
    expect((await letters(base.company.id)).filter((o) => o.status === "draft")).toHaveLength(2);
    await expect(composeNotice(t.db, [base.stale.id, de.id], deps)).rejects.toThrow(/one owner and one state/);
  });

  it("refuses to approve a letter while another open letter to the same owner and state exists", async () => {
    const { a } = await twoLetters();
    const err = await approveOutreach(t.db, a.outreachId, "ronit", { env }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutreachNotReadyError);
    expect((err as OutreachNotReadyError).problems.join(" ")).toMatch(/combined into one notice/);
    expect(await t.db.select().from(approvals).where(eq(approvals.subjectId, a.outreachId))).toHaveLength(0);
  });

  it("the approval payload hash covers every item: editing one item voids the approval and nothing is mailed", async () => {
    const { base, second, a } = await twoLetters();
    await consolidateLetters(t.db, base.company.id, deps);
    const row = await loadOutreach(t.db, a.outreachId);
    const before = (await prepareSend(t.db, row, { env })).payload as LetterPayload;
    expect(before.items.map((i) => i.referenceNumber)).toEqual(["10482", "10537"]);
    expect(before.totalCents).toBe(612_671);

    const approved = await approveOutreach(t.db, a.outreachId, "ronit", { env });
    expect(approved.payloadSha256).toBe(requestApprovalPayloadHash(before));

    await t.db.update(staleItems).set({ amountCents: 378_600 }).where(eq(staleItems.id, second.id));
    const after = (await prepareSend(t.db, await loadOutreach(t.db, a.outreachId), { env })).payload;
    expect(requestApprovalPayloadHash(after)).not.toBe(approved.payloadSha256);
    const createLetter = vi.fn();
    const err = await sendLetter(t.db, a.outreachId, "ronit", { env, createLetter }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredError);
    expect((err as ApprovalRequiredError).reason).toBe("payload_changed");
    expect(createLetter).not.toHaveBeenCalled();
  });

  it("adding an item to an approved notice voids the approval and the new notice lists all three", async () => {
    const { base, a } = await twoLetters();
    await consolidateLetters(t.db, base.company.id, deps);
    const approved = await approveOutreach(t.db, a.outreachId, "ronit", { env });
    const third = await sameOwnerItem(base, { ref: "10600", cents: 1_00, issue: "2025-12-01" });
    await composeLetter(t.db, third.id, deps);

    const [res] = (await composeAllDrafts(t.db, { companyId: base.company.id, channel: "letter" }, deps)).results;
    expect(res).toMatchObject({ status: "composed", itemCount: 3 });
    const old = await loadOutreach(t.db, a.outreachId);
    expect(old.status).toBe("cancelled");
    const [ap] = await t.db.select().from(approvals).where(eq(approvals.id, approved.approvalId));
    expect(ap!.consumedAt).not.toBeNull();
    const fresh = await loadOutreach(t.db, res!.outreachId);
    expect(fresh.status).toBe("draft");
    expect(fresh.body).toContain("$6,127.71");
    expect(fresh.body).toContain('data-notice-items="3"');
  });

  it("re-drafting any item in the notice recomposes the whole notice instead of starting a second letter", async () => {
    const { base, second, a } = await twoLetters();
    await consolidateLetters(t.db, base.company.id, deps);
    const r = await composeLetter(t.db, second.id, deps);
    expect(r.outreachId).toBe(a.outreachId);
    expect(r.payload?.items).toHaveLength(2);
    expect((await letters(base.company.id)).filter((o) => o.status === "draft")).toHaveLength(1);
  });

  it("one owner reply answers every item the notice listed", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "30001" });
    const second = await sameOwnerItem(base, { ref: "30002", cents: 9_999, issue: "2025-10-01" });
    const notice = await composeNotice(t.db, [base.stale.id, second.id], deps);
    const token = notice.ownerUrl!.split("/owner/")[1]!;
    await recordOwnerResponse(t.db, token, { intent: "already_cashed" }, { secret: TEST_SECRET, sendEvent: vi.fn(async () => {}) });
    const rows = await t.db.select().from(staleItems).where(eq(staleItems.ownerPayeeId, base.stale.ownerPayeeId!));
    expect(rows.map((s) => s.status)).toEqual(["owner_responded", "owner_responded"]);
  });

  it("single-item letters keep working and list their one item in the payload", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "40001", amountCents: 12_345 });
    const r = await composeLetter(t.db, base.stale.id, deps);
    expect(r.payload?.items).toEqual([{ staleItemId: base.stale.id, referenceNumber: "40001", issueDate: "2025-08-01", amountCents: 12_345 }]);
    expect(r.payload?.totalCents).toBe(12_345);
    expect(r.html).not.toContain("data-notice-items");
    expect(await t.db.select().from(outreachItems).where(eq(outreachItems.outreachId, r.outreachId))).toEqual([]);
  });
});
