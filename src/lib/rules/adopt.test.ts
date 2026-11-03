import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, ledgerItems, payees, ruleApprovals, ruleChanges, staleItems } from "@/db/schema";
import { seedItem } from "@/lib/outreach/testing";
import { adoptProposedValue, describeAdoption, draftableLetters, RuleAdoptError } from "./adopt";
import { loadRules, pinRules } from "./load";
import { setOverlayRows } from "./overlay";
import { proposedValue } from "./proposed";

const PATH = "dueDiligence.requiredLanguage";
const REAL_TX = readFileSync(path.resolve(process.cwd(), "rules/TX.json"), "utf8");

let t: TestDb;
let dir: string;
const OWNER = "Northwind Fixtures, Inc. is holding property for you. If it is not claimed, we may be required to deliver it to the Texas Comptroller on or before July 1.";

beforeEach(async () => {
  setOverlayRows([]);
  t = await createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "rules-adopt-"));
  writeFileSync(path.join(dir, "TX.json"), REAL_TX); // temp copy of the real file; the checked-in file is never written
});
afterEach(async () => {
  // R4-02: adoption never writes the rules directory.
  expect(readdirSync(dir)).toEqual(["TX.json"]);
  expect(readFileSync(path.join(dir, "TX.json"), "utf8")).toBe(REAL_TX);
  setOverlayRows([]);
  await t.close();
});

const seen = () => {
  const l = loadRules("TX", { dir });
  const proposedText = proposedValue(l.file.dueDiligence.requiredLanguage).proposed!;
  return { expectedVersion: l.file.version, expectedSha256: l.sha256, proposedText };
};
const input = (over: Partial<Parameters<typeof adoptProposedValue>[1]> = {}) => ({
  state: "TX",
  path: PATH,
  by: "Dana (passcode session abcd1234)",
  ownerText: OWNER,
  ...seen(),
  ...over,
});

describe("adoptProposedValue (R3-05)", () => {
  it("keeps the verbatim quote as the requirement, stores the owner sentence, and records a DB approval (no file writes)", async () => {
    const { proposedText, expectedSha256 } = seen();
    const res = await adoptProposedValue(t.db, input(), { dir, now: new Date("2026-11-03T12:00:00Z") });

    expect(res).toMatchObject({ value: proposedText, ownerText: OWNER, verifiedBy: "Dana (passcode session abcd1234)" });
    expect(res.version).toBe("2026.10.1-draft+appr.20261103T120000");
    const rv = loadRules("TX", { dir }).file.dueDiligence.requiredLanguage;
    expect(rv).toMatchObject({ value: proposedText, owner_text: OWNER, verified: true, verified_by: "Dana (passcode session abcd1234)", verified_at: "2026-11-03T12:00:00.000Z" });
    // Exactly equal to (a verbatim part of) the cited official quote; all sources kept.
    expect(rv.sources.some((s) => s.url === res.sources[0]!.url && s.quote.endsWith(rv.value!))).toBe(true);
    expect(rv.sources).toHaveLength(3);
    expect(rv.todo).toMatch(/^Adopted verbatim from .*claimittexas\.gov/);

    const [ap] = await t.db.select().from(approvals).where(eq(approvals.id, res.approvalId));
    expect(ap).toMatchObject({ action: "apply_rule_change", subjectId: "TX", approvedBy: "Dana (passcode session abcd1234)" });
    expect(ap?.consumedAt).not.toBeNull();
    const [rc] = await t.db.select().from(ruleChanges);
    expect(rc).toMatchObject({ state: "TX", fromVersion: "2026.10.1-draft", toVersion: res.version, status: "applied" });
    const [row] = await t.db.select().from(ruleApprovals);
    expect(row).toMatchObject({ state: "TX", kind: "adopt", version: res.version, value: proposedText, ownerText: OWNER, baseSha256: expectedSha256, approvedBy: "Dana (passcode session abcd1234)" });
    expect(row?.approvedAt.toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect((row?.sources as { url: string }[])[0]?.url).toBe(res.sources[0]!.url);

    // Only the adopted envelope and the version changed in the served rules; the baseline still pins exactly.
    const before = JSON.parse(REAL_TX);
    const after = JSON.parse(loadRules("TX", { dir }).text);
    delete before.version;
    delete after.version;
    delete before.dueDiligence.requiredLanguage;
    delete after.dueDiligence.requiredLanguage;
    expect(after).toEqual(before);
    expect(pinRules("TX", "2026.10.1-draft", { dir }).file.dueDiligence.requiredLanguage.value).toBeNull();
    // The repo's real file is untouched.
    expect(readFileSync(path.resolve(process.cwd(), "rules/TX.json"), "utf8")).toBe(REAL_TX);
  });

  it("R4-01: requires an owner-facing sentence and refuses holder-addressed or placeholder text", async () => {
    const { proposedText } = seen();
    for (const ownerText of [undefined, "", "Too short.", proposedText, "You, the holder, are holding the property for the owner.", "We are holding [OWNER NAME]'s property for you."]) {
      await expect(adoptProposedValue(t.db, input({ ownerText }), { dir })).rejects.toMatchObject({ code: "owner_text_invalid" });
    }
    expect(await t.db.select().from(approvals)).toHaveLength(0);
    expect(await t.db.select().from(ruleApprovals)).toHaveLength(0);
  });

  it("rejects a wrong sha or version (stale) and writes nothing", async () => {
    await expect(adoptProposedValue(t.db, input({ expectedSha256: "0".repeat(64) }), { dir })).rejects.toMatchObject({ code: "stale" });
    await expect(adoptProposedValue(t.db, input({ expectedVersion: "other" }), { dir })).rejects.toMatchObject({ code: "stale" });
    expect(existsSync(path.join(dir, "history"))).toBe(false);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });

  it("rejects a missing approver", async () => {
    for (const by of ["", "  ", "D"]) {
      await expect(adoptProposedValue(t.db, input({ by }), { dir })).rejects.toMatchObject({ code: "approver_required" });
    }
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });

  it("rejects text that is not exactly the quoted source text", async () => {
    const { proposedText } = seen();
    for (const text of [`${proposedText} `, proposedText.replace("July 1", "June 1"), "We are holding your property."]) {
      await expect(adoptProposedValue(t.db, input({ proposedText: text }), { dir })).rejects.toMatchObject({ code: "text_mismatch" });
    }
    expect(readFileSync(path.join(dir, "TX.json"), "utf8")).toBe(REAL_TX);
  });

  it("refuses fields with a value, with no proposal, or unknown paths; and a second adoption", async () => {
    await expect(adoptProposedValue(t.db, input({ path: "dueDiligence.mailingMethod" }), { dir })).rejects.toMatchObject({ code: "already_set" });
    await expect(adoptProposedValue(t.db, input({ path: "nope.field" }), { dir })).rejects.toBeInstanceOf(RuleAdoptError);
    const raw = JSON.parse(REAL_TX);
    raw.dueDiligence.requiredLanguage.sources = raw.dueDiligence.requiredLanguage.sources.filter((s: { url: string }) => !s.url.includes("96-478"));
    writeFileSync(path.join(dir, "TX.json"), `${JSON.stringify(raw, null, 2)}\n`);
    await expect(adoptProposedValue(t.db, input(), { dir })).rejects.toMatchObject({ code: "no_proposal" });

    writeFileSync(path.join(dir, "TX.json"), REAL_TX); // restore the temp copy (afterEach checks it)
    await adoptProposedValue(t.db, input(), { dir });
    const l = loadRules("TX", { dir });
    await expect(
      adoptProposedValue(t.db, input({ expectedVersion: l.file.version, expectedSha256: l.sha256, proposedText: "x" }), { dir }),
    ).rejects.toMatchObject({ code: "already_set" });
  });
});

describe("describeAdoption (R3-05)", () => {
  async function addTx(companyId: string, ref: string, opts: { amountCents: number; ddWindowStart: string; withAddress?: boolean; status?: "dd_pending" | "reported" }) {
    const withAddress = opts.withAddress ?? true;
    const [payee] = await t.db
      .insert(payees)
      .values({ companyId, canonicalName: `Payee ${ref}`, addressLine: withAddress ? "1 Main St" : null, city: withAddress ? "Austin" : null, state: withAddress ? "TX" : null, zip: withAddress ? "78701" : null })
      .returning();
    const [ledger] = await t.db
      .insert(ledgerItems)
      .values({ companyId, payeeId: payee!.id, payeeNameRaw: `Payee ${ref}`, propertyType: "vendor_check", referenceNumber: ref, amountCents: opts.amountCents, issueDate: "2023-08-01" })
      .returning();
    const [stale] = await t.db
      .insert(staleItems)
      .values({
        companyId,
        ledgerItemId: ledger!.id,
        ownerPayeeId: payee!.id,
        amountCents: opts.amountCents,
        propertyType: "vendor_check",
        ownerState: "TX",
        status: opts.status ?? "dd_pending",
        staleSince: "2026-02-01",
        ddWindowStart: opts.ddWindowStart,
      })
      .returning();
    return stale!;
  }

  it("reports before/after, citations and the TX items that become draftable", async () => {
    const base = await seedItem(t.db, { ownerState: "CA", ref: "CA0" });
    const companyId = base.company.id;
    const a = await addTx(companyId, "T1", { amountCents: 30_000, ddWindowStart: "2020-01-01" });
    const b = await addTx(companyId, "T2", { amountCents: 45_050, ddWindowStart: "2020-01-01" });
    await addTx(companyId, "T3", { amountCents: 70_000, ddWindowStart: "2099-01-01" }); // window not open
    await addTx(companyId, "T4", { amountCents: 90_000, ddWindowStart: "2020-01-01", withAddress: false });
    await addTx(companyId, "T5", { amountCents: 11_000, ddWindowStart: "2020-01-01", status: "reported" }); // closed: not blocked by the rule

    const d = await describeAdoption(t.db, { state: "TX", path: PATH, companyId }, { dir });
    expect(d.before).toMatchObject({ value: null, verified: false, status: { kind: "official_text_found" } });
    expect(d.after?.value).toBe(seen().proposedText);
    expect(d.after?.sources[0]?.url).toBe("https://claimittexas.gov/docs/96-478.pdf#page=13");
    expect(d.citations).toHaveLength(3);
    expect(d).toMatchObject({ expectedVersion: "2026.10.1-draft", expectedSha256: loadRules("TX", { dir }).sha256 });
    expect(d.impact).toEqual({
      blockedByRule: { count: 4, amountCents: 235_050 },
      becomeDraftable: { count: 2, amountCents: 75_050, staleItemIds: expect.arrayContaining([a.id, b.id]) },
      stillBlocked: { count: 2, amountCents: 160_000, byReason: { window_not_open: 1, missing_owner_address: 1 } },
    });
    expect(d.impact?.becomeDraftable.staleItemIds).toHaveLength(2);
    expect(d.ownerText).toEqual({ required: true, prefill: "" }); // never generated
    // Read-only.
    expect(await t.db.select().from(approvals)).toHaveLength(0);

    // After approval the live count matches the preview: the two open, addressed TX items can now be drafted.
    expect(await draftableLetters(t.db, { state: "TX", companyId }, { dir })).toEqual({ count: 0, amountCents: 0 });
    await adoptProposedValue(t.db, input(), { dir });
    expect(await draftableLetters(t.db, { state: "TX", companyId }, { dir })).toEqual({ count: 2, amountCents: 75_050 });
  });

  it("has no impact for fields that do not gate drafting or have nothing to adopt", async () => {
    const d = await describeAdoption(t.db, { state: "TX", path: "dueDiligence.mailingMethod", companyId: null }, { dir });
    expect(d).toMatchObject({ after: null, impact: null, proposal: { confidence: "none", reason: "has_value" }, before: { status: { kind: "unverified" } } });
  });
});
