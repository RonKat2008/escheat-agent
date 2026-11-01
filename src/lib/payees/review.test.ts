import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, payees, staleItems } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { computeItemTimeline } from "@/lib/pipeline/compute";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { applyPayeeChange, previewPayeeChange } from "./review";
import { PayeeChangeError } from "./review-types";
import { filterPayees, listPayees, reviewReasons } from "./review-queries";

let prevAnchor: string | undefined;
beforeAll(() => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  process.env.DEMO_ANCHOR_DATE = "2026-11-01";
});
afterAll(() => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
});

let t: TestDb;
let companyId: string;
let otherCompanyId: string;
beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co (SYNTHETIC)", incorporationState: "DE" }).returning();
  const [o] = await t.db.insert(companies).values({ name: "Other Co (SYNTHETIC)", incorporationState: "DE" }).returning();
  companyId = c!.id;
  otherCompanyId = o!.id;
});
afterEach(async () => {
  await t.close();
});

const CA = { addressLine: "12 Pier Rd", city: "Oakland", state: "CA", zip: "94607" };
const TX = { addressLine: "900 Main St", city: "Dallas", state: "TX", zip: "75001" };

async function addPayee(company: string, name: string, addr: typeof CA, extra: Partial<typeof payees.$inferInsert> = {}) {
  const [p] = await t.db.insert(payees).values({ companyId: company, canonicalName: name, ...addr, ...extra }).returning();
  return p!;
}

async function addItem(
  company: string,
  payeeId: string,
  raw: string,
  addr: typeof CA,
  opts: { number: string; cents: number; status?: "watching" | "resolved_paid" },
) {
  const [l] = await t.db
    .insert(ledgerItems)
    .values({
      companyId: company,
      payeeId,
      payeeNameRaw: raw,
      propertyType: "vendor_check",
      referenceNumber: opts.number,
      amountCents: opts.cents,
      issueDate: "2023-01-10",
      status: "outstanding",
      ...addr,
      source: "synthetic",
    })
    .returning();
  const [s] = await t.db
    .insert(staleItems)
    .values({
      companyId: company,
      ledgerItemId: l!.id,
      ownerPayeeId: payeeId,
      amountCents: opts.cents,
      propertyType: "vendor_check",
      ownerState: addr.state,
      ownerStateBasis: "address",
      status: opts.status ?? "watching",
      staleSince: "2023-07-10",
      lastActivityDate: "2023-01-10",
    })
    .returning();
  return { ledger: l!, stale: s! };
}

/** Acme Supply (CA address) with one item; ACME SUPLY CO (TX address) with two items (one closed). */
async function seedAcme() {
  const keep = await addPayee(companyId, "Acme Supply", CA);
  const gone = await addPayee(companyId, "ACME SUPLY CO", TX);
  const kept = await addItem(companyId, keep.id, "Acme Supply", CA, { number: "1001", cents: 100_00 });
  const moved = await addItem(companyId, gone.id, "ACME SUPLY CO", TX, { number: "2001", cents: 250_00 });
  const closed = await addItem(companyId, gone.id, "ACME SUPLY CO", TX, { number: "2002", cents: 75_00, status: "resolved_paid" });
  await recomputeTimelines(t.db, companyId);
  return { keep, gone, kept, moved, closed };
}

const stale = async (id: string) => (await t.db.select().from(staleItems).where(eq(staleItems.id, id)))[0]!;
const payee = async (id: string) => (await t.db.select().from(payees).where(eq(payees.id, id)))[0];
const merge = (keepId: string, mergeId: string) => ({ kind: "merge" as const, keepId, mergeId });

describe("previewPayeeChange", () => {
  it("shows a before/after diff and writes nothing", async () => {
    const { keep, gone, moved, closed } = await seedAcme();
    const before = await stale(moved.stale.id);
    const preview = await previewPayeeChange(t.db, companyId, merge(keep.id, gone.id));

    expect(preview.noop).toBe(false);
    expect(preview.diffs.map((d) => d.staleItemId).sort()).toEqual([closed.stale.id, moved.stale.id].sort());
    const d = preview.diffs.find((x) => x.staleItemId === moved.stale.id)!;
    expect(d.before.ownerState).toBe("TX");
    expect(d.after.ownerState).toBe("CA");
    expect(d.ownerStateChanged).toBe(true);
    expect(d.amountCents).toBe(250_00);
    // closed items move payee but are never recomputed
    const c = preview.diffs.find((x) => x.staleItemId === closed.stale.id)!;
    expect(c.closed).toBe(true);
    expect(c.after.ownerState).toBe("TX");
    expect(preview.ownerStateChanges).toBe(1);
    expect(preview.resultingAliases).toEqual(["ACME SUPLY CO"]);

    expect(await stale(moved.stale.id)).toEqual(before);
    expect(await payee(gone.id)).toBeDefined();
    expect((await payee(keep.id))!.aliases).toEqual([]);
  });
});

describe("merge", () => {
  it("moves items, records alias bookkeeping and the human trail, and re-derives legal dates from the new owner state", async () => {
    const { keep, gone, kept, moved, closed } = await seedAcme();
    const preview = await previewPayeeChange(t.db, companyId, merge(keep.id, gone.id));
    const res = await applyPayeeChange(t.db, companyId, { change: merge(keep.id, gone.id), by: "Reviewer One", fingerprint: preview.fingerprint });
    expect(res.applied).toBe(true);

    expect(await payee(gone.id)).toBeUndefined();
    const k = (await payee(keep.id))!;
    expect(k.aliases).toEqual(["ACME SUPLY CO"]);
    expect(k.canonicalName).toBe("Acme Supply");
    expect(k.mergeBasis).toBe("human");
    expect(k.mergeConfidence).toBe(100);
    expect(k.reviewedBy).toBe("Reviewer One");
    expect(k.reviewedAt).toBeInstanceOf(Date);
    expect(k.reviewAction).toBe("merge");

    const m = await stale(moved.stale.id);
    expect(m.ownerPayeeId).toBe(keep.id);
    expect(m.ownerState).toBe("CA");
    const expected = computeItemTimeline({
      ownerState: "CA",
      propertyType: "vendor_check",
      lastActivityDate: "2023-01-10" as IsoDate,
      amountCents: 250_00,
      holderFiscalYearEnd: "12-31",
    });
    expect(m.reportDueDate).toBe(expected.dates.reportDueDate);
    expect(m.presumedAbandonedDate).toBe(expected.dates.presumedAbandonedDate);
    // the diff the reviewer confirmed is what was written
    const d = preview.diffs.find((x) => x.staleItemId === moved.stale.id)!;
    expect(d.after.reportDueDate).toBe(m.reportDueDate);
    expect(d.after.status).toBe(m.status);

    const c = await stale(closed.stale.id);
    expect(c.ownerPayeeId).toBe(keep.id);
    expect(c.status).toBe("resolved_paid");
    expect(c.ownerState).toBe("TX");
    expect((await stale(kept.stale.id)).ownerState).toBe("CA");
    const line = (await t.db.select().from(ledgerItems).where(eq(ledgerItems.id, moved.ledger.id)))[0]!;
    expect(line.payeeId).toBe(keep.id);
  });

  it("is idempotent: repeating the merge changes nothing", async () => {
    const { keep, gone, moved } = await seedAcme();
    const input = { change: merge(keep.id, gone.id), by: "Reviewer One" };
    await applyPayeeChange(t.db, companyId, input, new Date("2026-11-01T10:00:00Z"));
    const snapshot = JSON.stringify([await payee(keep.id), await stale(moved.stale.id)]);
    const again = await applyPayeeChange(t.db, companyId, input, new Date("2026-11-02T10:00:00Z"));
    expect(again.applied).toBe(false);
    expect(again.preview.noop).toBe(true);
    expect(JSON.stringify([await payee(keep.id), await stale(moved.stale.id)])).toBe(snapshot);
  });

  it("rejects invalid input without writing", async () => {
    const { keep, gone } = await seedAcme();
    const ok = { by: "Reviewer One" };
    await expect(applyPayeeChange(t.db, companyId, { ...ok, change: merge(keep.id, keep.id) })).rejects.toMatchObject({ code: "invalid" });
    await expect(applyPayeeChange(t.db, companyId, { ...ok, change: { kind: "merge", keepId: "nope", mergeId: gone.id } })).rejects.toMatchObject({ code: "invalid" });
    await expect(applyPayeeChange(t.db, companyId, { change: merge(keep.id, gone.id), by: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(applyPayeeChange(t.db, companyId, { ...ok, change: { kind: "explode" } })).rejects.toBeInstanceOf(PayeeChangeError);
    expect(await payee(gone.id)).toBeDefined();
  });

  it("is scoped to the company: another company's payees are not found and stay untouched", async () => {
    const { keep } = await seedAcme();
    const foreign = await addPayee(otherCompanyId, "Foreign Vendor", TX);
    const fItem = await addItem(otherCompanyId, foreign.id, "Foreign Vendor", TX, { number: "9001", cents: 10_00 });
    await expect(previewPayeeChange(t.db, companyId, merge(keep.id, foreign.id))).rejects.toMatchObject({ code: "not_found" });
    await expect(applyPayeeChange(t.db, companyId, { change: merge(foreign.id, keep.id), by: "Reviewer One" })).rejects.toMatchObject({ code: "not_found" });
    // and the foreign company cannot reach ours
    await expect(previewPayeeChange(t.db, otherCompanyId, merge(foreign.id, keep.id))).rejects.toMatchObject({ code: "not_found" });
    expect((await payee(foreign.id))!.canonicalName).toBe("Foreign Vendor");
    expect((await stale(fItem.stale.id)).ownerPayeeId).toBe(foreign.id);
    expect((await payee(keep.id))!.aliases).toEqual([]);
  });

  it("refuses a stale preview fingerprint and writes nothing", async () => {
    const { keep, gone, moved } = await seedAcme();
    const preview = await previewPayeeChange(t.db, companyId, merge(keep.id, gone.id));
    await t.db.update(staleItems).set({ amountCents: 999_00 }).where(eq(staleItems.id, moved.stale.id));
    await expect(
      applyPayeeChange(t.db, companyId, { change: merge(keep.id, gone.id), by: "Reviewer One", fingerprint: preview.fingerprint }),
    ).rejects.toMatchObject({ code: "stale_preview" });
    expect(await payee(gone.id)).toBeDefined();
    expect((await stale(moved.stale.id)).ownerPayeeId).toBe(gone.id);
  });
});

describe("split", () => {
  it("pulls an alias out into its own payee and recomputes owner state from that alias's address", async () => {
    const { keep, gone, moved } = await seedAcme();
    await applyPayeeChange(t.db, companyId, { change: merge(keep.id, gone.id), by: "Reviewer One" });
    expect((await stale(moved.stale.id)).ownerState).toBe("CA");

    const change = { kind: "split" as const, payeeId: keep.id, alias: "ACME SUPLY CO" };
    const preview = await previewPayeeChange(t.db, companyId, change);
    const d = preview.diffs.find((x) => x.staleItemId === moved.stale.id)!;
    expect(d.before.ownerState).toBe("CA");
    expect(d.after.ownerState).toBe("TX");

    const res = await applyPayeeChange(t.db, companyId, { change, by: "Reviewer Two", fingerprint: preview.fingerprint });
    expect(res.applied).toBe(true);
    const created = (await payee(res.payeeId!))!;
    expect(created.canonicalName).toBe("ACME SUPLY CO");
    expect(created.aliases).toEqual([]);
    expect(created.mergeBasis).toBe("human");
    expect(created.reviewedBy).toBe("Reviewer Two");
    expect(created.reviewAction).toBe("split");
    expect(created.state).toBe("TX");
    expect((await payee(keep.id))!.aliases).toEqual([]);
    const m = await stale(moved.stale.id);
    expect(m.ownerPayeeId).toBe(created.id);
    expect(m.ownerState).toBe("TX");
    // untouched item keeps its payee
    expect((await t.db.select().from(staleItems).where(eq(staleItems.ownerPayeeId, keep.id))).map((r) => r.ledgerItemId)).toHaveLength(1);
  });

  it("rejects unknown aliases and the canonical name; a repeated split changes nothing", async () => {
    const { keep, gone } = await seedAcme();
    await applyPayeeChange(t.db, companyId, { change: merge(keep.id, gone.id), by: "Reviewer One" });
    const by = "Reviewer One";
    await expect(applyPayeeChange(t.db, companyId, { by, change: { kind: "split", payeeId: keep.id, alias: "Nope Inc" } })).rejects.toMatchObject({ code: "alias_not_found" });
    await expect(applyPayeeChange(t.db, companyId, { by, change: { kind: "split", payeeId: keep.id, alias: "Acme Supply" } })).rejects.toMatchObject({ code: "invalid" });
    const change = { kind: "split" as const, payeeId: keep.id, alias: "ACME SUPLY CO" };
    await applyPayeeChange(t.db, companyId, { by, change });
    const count = (await t.db.select().from(payees)).length;
    await expect(applyPayeeChange(t.db, companyId, { by, change })).rejects.toMatchObject({ code: "alias_not_found" });
    expect((await t.db.select().from(payees)).length).toBe(count);
  });

  it("cannot split another company's payee", async () => {
    const foreign = await addPayee(otherCompanyId, "Foreign Vendor", TX, { aliases: ["FOREIGN V"] });
    await expect(previewPayeeChange(t.db, companyId, { kind: "split", payeeId: foreign.id, alias: "FOREIGN V" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("rename", () => {
  it("changes the canonical name, keeps the old one as an alias, and does not touch items", async () => {
    const { keep, kept } = await seedAcme();
    const before = await stale(kept.stale.id);
    const res = await applyPayeeChange(t.db, companyId, { change: { kind: "rename", payeeId: keep.id, canonicalName: "Acme Supply Co." }, by: "Reviewer One" });
    expect(res.applied).toBe(true);
    const p = (await payee(keep.id))!;
    expect(p.canonicalName).toBe("Acme Supply Co.");
    expect(p.aliases).toEqual(["Acme Supply"]);
    expect(p.mergeBasis).toBe("human");
    expect(p.reviewAction).toBe("rename");
    expect(await stale(kept.stale.id)).toEqual(before);
  });

  it("promoting an alias swaps it with the canonical name", async () => {
    const { keep, gone } = await seedAcme();
    await applyPayeeChange(t.db, companyId, { change: merge(keep.id, gone.id), by: "Reviewer One" });
    await applyPayeeChange(t.db, companyId, { change: { kind: "rename", payeeId: keep.id, canonicalName: "ACME SUPLY CO" }, by: "Reviewer One" });
    const p = (await payee(keep.id))!;
    expect(p.canonicalName).toBe("ACME SUPLY CO");
    expect(p.aliases).toEqual(["Acme Supply"]);
  });

  it("is idempotent, and rejects blank names and names used by another payee", async () => {
    const { keep, gone } = await seedAcme();
    const by = "Reviewer One";
    const same = await applyPayeeChange(t.db, companyId, { by, change: { kind: "rename", payeeId: keep.id, canonicalName: "Acme Supply" } });
    expect(same.applied).toBe(false);
    expect((await payee(keep.id))!.reviewedBy).toBeNull();
    await expect(applyPayeeChange(t.db, companyId, { by, change: { kind: "rename", payeeId: keep.id, canonicalName: "  " } })).rejects.toMatchObject({ code: "invalid" });
    await expect(applyPayeeChange(t.db, companyId, { by, change: { kind: "rename", payeeId: keep.id, canonicalName: "acme suplY co" } })).rejects.toMatchObject({ code: "name_taken" });
    expect((await payee(gone.id))!.canonicalName).toBe("ACME SUPLY CO");
  });
});

describe("review queries", () => {
  it("rolls up items and flags likely duplicates and low-confidence / model merges", async () => {
    const a = await addPayee(companyId, "Glenmoor Metalworks", CA, { mergeBasis: "model", mergeConfidence: 82 });
    const b = await addPayee(companyId, "Glenmoor Metalworks Inc.", CA);
    const c = await addPayee(companyId, "Zebra Freight", TX);
    await addItem(companyId, a.id, "Glenmoor Metalworks", CA, { number: "1", cents: 500_00 });
    await addItem(companyId, c.id, "Zebra Freight", TX, { number: "2", cents: 70_00 });
    await addItem(companyId, c.id, "Zebra Freight", TX, { number: "3", cents: 30_00, status: "resolved_paid" });

    const rows = await listPayees(t.db, companyId);
    const ra = rows.find((r) => r.id === a.id)!;
    expect(ra.outstandingCents).toBe(500_00);
    expect(ra.ownerStates).toEqual(["CA"]);
    expect(ra.needsReview).toBe(true);
    expect(ra.reasons.join(" ")).toMatch(/model/i);
    expect(ra.reasons.join(" ")).toMatch(/duplicate/i);
    expect(ra.suggestions[0]!.otherId).toBe(b.id);
    const rc = rows.find((r) => r.id === c.id)!;
    expect(rc.itemCount).toBe(2);
    expect(rc.openItemCount).toBe(1);
    expect(rc.outstandingCents).toBe(70_00);
    expect(rc.needsReview).toBe(false);

    expect(filterPayees(rows, { show: "review" }).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(filterPayees(rows, { q: "zebra" }).map((r) => r.id)).toEqual([c.id]);
    expect(filterPayees(rows, { state: "tx" }).map((r) => r.id)).toEqual([c.id]);
    expect(filterPayees(rows, { basis: "model" }).map((r) => r.id)).toEqual([a.id]);
  });

  it("does not list another company's payees", async () => {
    await addPayee(otherCompanyId, "Foreign Vendor", TX);
    expect(await listPayees(t.db, companyId)).toEqual([]);
  });

  it("a human-reviewed payee is not flagged for confidence", async () => {
    const p = await addPayee(companyId, "Solo Vendor", CA, { mergeBasis: "human", mergeConfidence: 100 });
    expect(reviewReasons(p, [])).toEqual([]);
    expect(reviewReasons({ ...p, mergeBasis: "rule", mergeConfidence: 85 }, [])).toHaveLength(1);
  });
});
