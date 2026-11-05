import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, staleItems } from "@/db/schema";
import { approve, consumeApproval } from "@/lib/approvals";
import { moveDemoClock } from "@/lib/pipeline/clock-move";
import { resetDemoClock } from "@/lib/pipeline/clock-reset";
import { appendAuditEvent, companiesForSubject, loadChain, verifyChain } from "./chain-db";
import { GENESIS_HASH } from "./chain";

const ANCHOR = "2026-11-01";
let prevAnchor: string | undefined;
let prevDemo: string | undefined;
beforeAll(() => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  prevDemo = process.env.DEMO_MODE;
  process.env.DEMO_ANCHOR_DATE = ANCHOR;
  process.env.DEMO_MODE = "1";
});
afterAll(() => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
});

let t: TestDb;
let companyId: string;
let itemId: string;

beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
  const [l] = await t.db
    .insert(ledgerItems)
    .values({ companyId, payeeNameRaw: "Bayline Electric", propertyType: "vendor_check", referenceNumber: "10501", amountCents: 234_000, issueDate: "2025-09-01", state: "TX" })
    .returning();
  const [s] = await t.db
    .insert(staleItems)
    .values({ companyId, ledgerItemId: l!.id, ownerState: "TX", propertyType: "vendor_check", amountCents: 234_000, staleSince: "2026-09-01", status: "watching" })
    .returning();
  itemId = s!.id;
});
afterEach(async () => {
  await t.close();
});

describe("audit chain in the database", () => {
  it("a clock move followed by an approval appends rows in order and verifies", async () => {
    await moveDemoClock(t.db, companyId, 30);
    const approval = await approve(t.db, { action: "mark_resolved_paid", subjectId: itemId, payload: { x: 1 }, approvedBy: "Dana Reviewer" });
    await consumeApproval(t.db, approval.id);

    const rows = await loadChain(t.db, companyId);
    expect(rows.map((r) => [r.seq, r.kind])).toEqual([
      [1, "clock.move"],
      [2, "approval.granted"],
      [3, "approval.consumed"],
    ]);
    expect(rows[0]!.prevHash).toBe(GENESIS_HASH);
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({ prevDay: ANCHOR, day: "2026-12-01", direction: "forward" });
    expect(JSON.parse(rows[1]!.payload)).toMatchObject({ action: "mark_resolved_paid", subject: itemId, approvedBy: "Dana Reviewer" });

    const v = await verifyChain(t.db, companyId);
    expect(v).toEqual({ ok: true, length: 3, headHash: rows[2]!.hash });
  });

  it("keeps the chain across a clock reset and appends a clock.reset row", async () => {
    await moveDemoClock(t.db, companyId, 30);
    await resetDemoClock(t.db, companyId);
    const rows = await loadChain(t.db, companyId);
    expect(rows.map((r) => r.kind)).toEqual(["clock.move", "clock.reset"]);
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);
  });

  it("rolls the chain row back with the transaction that failed", async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await appendAuditEvent(tx as never, { companyId, kind: "test.event", subjectType: "x", subjectId: "1", payload: {} });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await loadChain(t.db, companyId)).toEqual([]);
  });

  it("refuses UPDATE on stored rows (append-only trigger)", async () => {
    await appendAuditEvent(t.db, { companyId, kind: "test.event", subjectType: "x", subjectId: "1", payload: { a: 1 } });
    const err = await t.db.execute(sql`UPDATE audit_chain SET payload = '{"a":2}'`).then(
      () => null,
      (e: unknown) => e as { cause?: { message?: string } },
    );
    expect(err?.cause?.message).toMatch(/append-only/);
  });

  it("refuses DELETE and TRUNCATE on stored rows, so tail deletion cannot leave a shorter valid chain", async () => {
    for (let i = 0; i < 3; i++) await appendAuditEvent(t.db, { companyId, kind: "test.event", subjectType: "x", subjectId: String(i), payload: { i } });
    const fail = (q: ReturnType<typeof sql>) =>
      t.db.execute(q).then(
        () => null,
        (e: unknown) => (e as { cause?: { message?: string } }).cause?.message ?? String(e),
      );
    expect(await fail(sql`DELETE FROM audit_chain WHERE seq = 3`)).toMatch(/append-only/);
    expect(await fail(sql`DELETE FROM audit_chain`)).toMatch(/append-only/);
    expect(await fail(sql`TRUNCATE audit_chain`)).toMatch(/append-only/);
    expect(await fail(sql`DELETE FROM companies WHERE id = ${companyId}::uuid`)).toMatch(/append-only/);
    expect(await verifyChain(t.db, companyId)).toMatchObject({ ok: true, length: 3 });
  });

  it("the reset bypass works only inside the transaction that sets it; verification is unchanged", async () => {
    for (let i = 0; i < 3; i++) await appendAuditEvent(t.db, { companyId, kind: "test.event", subjectType: "x", subjectId: String(i), payload: { i } });
    await t.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('escheat.allow_reset', 'on', true)`);
      await tx.execute(sql`DELETE FROM audit_chain WHERE seq = 2`);
    });
    expect(await verifyChain(t.db, companyId)).toMatchObject({ ok: false, length: 2, firstBrokenSeq: 2 });
    const err = await t.db.execute(sql`DELETE FROM audit_chain`).then(
      () => null,
      (e: unknown) => e as { cause?: { message?: string } },
    );
    expect(err?.cause?.message).toMatch(/append-only/);
  });

  it("finds the company for item, remittance and state subjects", async () => {
    expect(await companiesForSubject(t.db, itemId)).toEqual([companyId]);
    expect(await companiesForSubject(t.db, "TX")).toEqual([companyId]);
    expect(await companiesForSubject(t.db, "NY")).toEqual([]);
    expect(await companiesForSubject(t.db, `remit:${companyId}`)).toEqual([companyId]);
  });
});
