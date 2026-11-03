import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, ruleApprovals } from "@/db/schema";
import { loadRules } from "@/lib/rules/load";
import { setOverlayRows } from "@/lib/rules/overlay";
import { seedItem } from "@/lib/outreach/testing";

let t: TestDb;
let dir: string;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));
// The route reads and writes rules through src/lib/rules/adopt; point it at a temp copy so the real files are never written.
vi.mock("@/lib/rules/adopt", async (orig) => {
  const m = await orig<typeof import("@/lib/rules/adopt")>();
  return {
    ...m,
    describeAdoption: (db: Parameters<typeof m.describeAdoption>[0], args: Parameters<typeof m.describeAdoption>[1]) => m.describeAdoption(db, args, { dir }),
    adoptProposedValue: (db: Parameters<typeof m.adoptProposedValue>[0], input: Parameters<typeof m.adoptProposedValue>[1]) =>
      m.adoptProposedValue(db, input, { dir }),
  };
});

import { GET, POST } from "./[state]/adopt/route";

const REAL_TX = readFileSync(path.resolve(process.cwd(), "rules/TX.json"), "utf8");
const PATH = "dueDiligence.requiredLanguage";
const ctx = (state: string) => ({ params: Promise.resolve({ state }) });
const post = (body: unknown) => new Request("http://x/api/rules/TX/adopt", { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  t = await createTestDb();
  await seedItem(t.db, { ownerState: "TX", ref: "RT1" });
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

const OWNER = "Northwind Fixtures, Inc. is holding property for you. We may be required to deliver it to the Texas Comptroller on or before July 1 if it is not claimed.";

/** A temp copy of the rule file and no rule approvals (they are DB rows the loader overlays, R4-02). */
async function freshRules() {
  dir = mkdtempSync(path.join(tmpdir(), "rules-route-"));
  writeFileSync(path.join(dir, "TX.json"), REAL_TX);
  await t.db.delete(ruleApprovals);
  setOverlayRows([]);
}

async function preview() {
  const res = await GET(new Request(`http://x/api/rules/tx/adopt?path=${PATH}`), ctx("tx"));
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/rules/[state]/adopt", () => {
  it("returns the proposal, plain-language status, hashes and impact", async () => {
    await freshRules();
    const json = await preview();
    expect(json).toMatchObject({
      state: "TX",
      path: PATH,
      expectedVersion: "2026.10.1-draft",
      proposal: { confidence: "verbatim_quote" },
      before: { value: null, status: { kind: "official_text_found" } },
      after: { verified: true },
    });
    expect(json.before.status.text).toMatch(/^Texas notice wording not yet confirmed; official text found at/);
    expect(json.expectedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(json.impact.blockedByRule.count).toBeGreaterThanOrEqual(0);
  });

  it("400 without a path, 404 for an unknown state or field", async () => {
    await freshRules();
    expect((await GET(new Request("http://x/api/rules/TX/adopt"), ctx("TX"))).status).toBe(400);
    expect((await GET(new Request(`http://x/api/rules/ZZ/adopt?path=${PATH}`), ctx("ZZ"))).status).toBe(404);
    expect((await GET(new Request("http://x/api/rules/TX/adopt?path=nope"), ctx("TX"))).status).toBe(404);
  });
});

describe("POST /api/rules/[state]/adopt", () => {
  it("adopts the exact proposed text with a human approver (201), then 409 on replay", async () => {
    await freshRules();
    const p = await preview();
    const body = { path: PATH, approvedBy: "Dana", expectedVersion: p.expectedVersion, expectedSha256: p.expectedSha256, proposedText: p.after.value, ownerText: OWNER };
    const res = await POST(post(body), ctx("TX"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ path: PATH, value: p.after.value, ownerText: OWNER, verifiedBy: "Dana (local dev, gate disabled)" });
    expect(json.version).toMatch(/^2026\.10\.1-draft\+appr\./);
    expect(json.draftable).toMatchObject({ count: expect.any(Number), amountCents: expect.any(Number) });
    // R4-02: served from the DB overlay; the temp file is untouched.
    expect(loadRules("TX", { dir }).file.dueDiligence.requiredLanguage).toMatchObject({ value: p.after.value, owner_text: OWNER });
    expect(readFileSync(path.join(dir, "TX.json"), "utf8")).toBe(REAL_TX);
    expect(await t.db.select().from(ruleApprovals)).toHaveLength(1);
    expect((await POST(post(body), ctx("TX"))).status).toBe(409); // stale: the rules changed
    expect(readFileSync(path.resolve(process.cwd(), "rules/TX.json"), "utf8")).toBe(REAL_TX);
  });

  it("rejects a missing approver (400), a wrong hash (409) and changed text (409), recording no approval", async () => {
    await freshRules();
    const before = (await t.db.select().from(approvals)).length;
    const p = await preview();
    const ok = { path: PATH, approvedBy: "Dana", expectedVersion: p.expectedVersion, expectedSha256: p.expectedSha256, proposedText: p.after.value, ownerText: OWNER };
    const holder = await POST(post({ ...ok, ownerText: p.after.value }), ctx("TX"));
    expect(holder.status).toBe(422); // R4-01: holder-addressed statute text is not an owner sentence
    expect((await holder.json()).code).toBe("owner_text_invalid");
    expect((await POST(post({ ...ok, approvedBy: "" }), ctx("TX"))).status).toBe(400);
    expect((await POST(post({ ...ok, approvedBy: undefined }), ctx("TX"))).status).toBe(400);
    const stale = await POST(post({ ...ok, expectedSha256: "a".repeat(64) }), ctx("TX"));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("stale");
    const edited = await POST(post({ ...ok, proposedText: "We are holding your property." }), ctx("TX"));
    expect(edited.status).toBe(409);
    expect((await edited.json()).code).toBe("text_mismatch");
    expect(await t.db.select().from(approvals)).toHaveLength(before);
    expect(readFileSync(path.join(dir, "TX.json"), "utf8")).toBe(REAL_TX);
  });

  it("requires a passcode session when the gate is on (401)", async () => {
    vi.stubEnv("APP_PASSCODE", "secret-passcode");
    expect((await POST(post({}), ctx("TX"))).status).toBe(401);
    expect((await GET(new Request(`http://x/api/rules/TX/adopt?path=${PATH}`), ctx("TX"))).status).toBe(401);
  });
});
