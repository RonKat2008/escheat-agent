import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach, staleItems } from "@/db/schema";
import type { ComposeDeps } from "@/lib/letters/compose";
import { DraftRefusedError, draftOutreach } from "./draft";
import { errorInfo } from "./http";
import { seedItem, testEnv } from "./testing";

let t: TestDb;
const deps: ComposeDeps = {
  env: testEnv(),
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

describe("single-item draft guard (R3-04)", () => {
  it.each(["letter", "email", "voice"] as const)("refuses a %s for an item whose window has passed (to_report) and writes nothing", async (channel) => {
    const { stale } = await seedItem(t.db, { ownerState: "CA", ref: `G-${channel}`, status: "to_report" });
    const err = await draftOutreach(t.db, stale.id, channel, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftRefusedError);
    expect((err as Error).message).toMatch(/Due-diligence window has passed; the item is in the report queue/);
    expect(await t.db.select().from(outreach).where(eq(outreach.staleItemId, stale.id))).toHaveLength(0);
  });

  it("refuses already reported and paid items with the bulk-draft wording", async () => {
    const reported = await seedItem(t.db, { ownerState: "CA", ref: "G-rep", status: "reported" });
    await expect(draftOutreach(t.db, reported.stale.id, "letter", deps)).rejects.toThrow(/already reported/);
    const paid = await seedItem(t.db, { ownerState: "CA", ref: "G-paid", status: "resolved_paid" });
    await expect(draftOutreach(t.db, paid.stale.id, "letter", deps)).rejects.toThrow(/resolved as paid/);
  });

  it("maps to HTTP 409 with a stable code the UI can show", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA", ref: "G-http", status: "to_report" });
    const err = await draftOutreach(t.db, stale.id, "letter", deps).catch((e: unknown) => e);
    const info = errorInfo(err);
    expect(info.status).toBe(409);
    expect(info.extra).toEqual({ code: "draft_refused" });
    expect(info.error).toMatch(/report queue/);
  });

  it("still drafts an open item, and still recomposes an existing draft", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA", ref: "G-open", status: "dd_pending" });
    const first = await draftOutreach(t.db, stale.id, "letter", deps);
    const again = await draftOutreach(t.db, stale.id, "letter", deps);
    expect(again.outreachId).toBe(first.outreachId);
  });
});

describe("email required-language readiness (R3-15)", () => {
  const rules = (value: string | null, verified: boolean): NonNullable<ComposeDeps["loadRules"]> =>
    (() => ({ file: { version: "t", dueDiligence: { requiredLanguage: { value, verified }, minAmountCents: { value: null } } } })) as unknown as NonNullable<ComposeDeps["loadRules"]>;

  it("blocks the email when the state's required language is UNKNOWN, like the letter", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "TX", ref: "E-unk" });
    const email = await draftOutreach(t.db, stale.id, "email", { ...deps, loadRules: rules(null, false) });
    expect(email.readiness.ready).toBe(false);
    expect(email.readiness.problems.join(" ")).toMatch(/required notice language for TX is UNKNOWN/);
    const letter = await draftOutreach(t.db, stale.id, "letter", { ...deps, loadRules: rules(null, false) });
    expect(letter.readiness.problems.join(" ")).toMatch(/required notice language for TX is UNKNOWN/);
  });

  it("warns, without blocking, when the language exists but is unverified", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA", ref: "E-unv" });
    const email = await draftOutreach(t.db, stale.id, "email", { ...deps, loadRules: rules("Some statutory text", false) });
    expect(email.readiness.ready).toBe(true);
    expect(email.readiness.warnings).toContain("CA required-language rule value is UNVERIFIED");
  });

  it("adds nothing when the language is verified, and blocks when the owner state is unknown", async () => {
    const ok = await seedItem(t.db, { ownerState: "CA", ref: "E-ok" });
    const email = await draftOutreach(t.db, ok.stale.id, "email", { ...deps, loadRules: rules("Text", true) });
    expect(email.readiness).toMatchObject({ ready: true, warnings: [] });
    const noState = await seedItem(t.db, { ownerState: null, ref: "E-nostate" });
    await t.db.update(staleItems).set({ status: "dd_pending" }).where(eq(staleItems.id, noState.stale.id));
    const blocked = await draftOutreach(t.db, noState.stale.id, "email", deps);
    expect(blocked.readiness.ready).toBe(false);
  });
});
