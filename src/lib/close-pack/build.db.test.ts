/**
 * The close pack against the SYNTHETIC demo seed for 2026-11: the manifest hashes match the bytes, the journal ties,
 * the audit chain verifies, and the ZIP lists the six files.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { resetClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { syncRulesToDb } from "@/lib/rules/load";
import { buildBundle } from "@/lib/synthetic/build";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { seedDemo } from "@/lib/synthetic/seed";
import { buildClosePack, type ClosePack } from "./build";
import { listZip } from "./zip";

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let pack: ClosePack;
let prevAnchor: string | undefined;

beforeAll(async () => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  process.env.DEMO_ANCHOR_DATE = DEMO_ANCHOR_DATE;
  t = await createTestDb();
  const bundle = buildBundle();
  await seedDemo(t.db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  await syncRulesToDb(t.db);
  const companyId = (await resolveCompanyId(t.db))!;
  await resetClock(t.db, companyId);
  await detectStaleItems(t.db, companyId, { classify });
  const r = await buildClosePack(t.db, companyId, "2026-11");
  if (!r.ok) throw new Error(r.error);
  pack = r.pack;
}, 180_000);

afterAll(async () => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  await t?.close?.();
});

describe("close pack, seed 2026-11", () => {
  it("zips the six expected files", () => {
    expect(listZip(pack.zip).map((e) => e.name)).toEqual(["journal-2026-11.csv", "rollforward-2026-11.pdf", "audit-binder.pdf", "activity-2026-11.csv", "tie-out-2026-11.pdf", "manifest.json"]);
  });

  it("manifest hashes and sizes match the bytes", () => {
    const byName = new Map(pack.files.map((f) => [f.name, f.data]));
    expect(pack.manifest.files).toHaveLength(5);
    for (const f of pack.manifest.files) {
      const data = byName.get(f.name)!;
      expect(f.sha256).toBe(sha256Hex(data));
      expect(f.bytes).toBe(data.length);
    }
    expect(pack.manifest).toMatchObject({ period: "2026-11", synthetic: true, auditChain: { verified: true } });
    expect(pack.manifest.auditChain.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the journal and the audit chain tie", () => {
    const journal = pack.tieLines.filter((l) => l.section === "Journal");
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.every((l) => l.status === "tie")).toBe(true);
    expect(pack.tieLines.find((l) => l.id === "chain")!.status).toBe("tie");
    expect(pack.tieLines.find((l) => l.id === "activity-count")!.status).toBe("tie");
  });

  it("every roll-forward line ties on the seed, or says why not", () => {
    const bad = pack.tieLines.filter((l) => l.status !== "tie");
    // Surfaced rather than asserted away: a non-tie must be visible in the report.
    expect(bad.map((l) => `${l.id}: ${l.detail}`)).toEqual([]);
  });

  it("rejects a month that has not started on the demo clock", async () => {
    const companyId = (await resolveCompanyId(t.db))!;
    const r = await buildClosePack(t.db, companyId, "2027-06");
    expect(r.ok).toBe(false);
  });
});
