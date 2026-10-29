import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach, payees } from "@/db/schema";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { loadRules } from "@/lib/rules/load";
import { seedItem, testEnv } from "@/lib/outreach/testing";
import { verifyOwnerToken } from "@/lib/outreach/tokens";
import { TEST_SECRET } from "@/lib/outreach/testing";
import { composeLetter } from "./compose";
import { UNKNOWN_LANGUAGE_MARKER } from "./template";

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
const env = testEnv();

describe("composeLetter", () => {
  it("CA: verbatim statutory language, template fallback labeled, owner link, persisted draft", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const r = await composeLetter(t.db, stale.id, { env, draftVariables: failing });
    const ca = loadRules("CA").file.dueDiligence.requiredLanguage.value!;
    expect(r.html).toContain(ca);
    expect(r.variablesSource).toBe("template");
    expect(r.html).toContain("variables_source: template");
    expect(r.readiness.ready).toBe(true);
    expect(r.readiness.warnings.join()).toMatch(/UNVERIFIED/);
    expect(r.payload?.kind).toBe("letter");
    expect(r.payload?.to.address_zip).toBe("94105");
    expect(r.html).toContain("Bayline Electric");
    expect(r.html).toContain("$2,340.00");
    expect(r.html).toContain("10482");
    const m = r.html.match(/https:\/\/escheat\.test\/owner\/([^<\s]+)/);
    expect(m).toBeTruthy();
    expect(verifyOwnerToken(m![1]!, new Date(), TEST_SECRET).outreachId).toBe(r.outreachId);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, r.outreachId));
    expect(row?.body).toBe(r.html);
    expect(row?.status).toBe("draft");
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses model variables when available and labels the source", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const r = await composeLetter(t.db, stale.id, {
      env,
      draftVariables: async () => ({ greeting: "Dear Bayline Electric,", itemDescription: "Check 10482 for $2,340.00.", responseInstructions: "Reply online." }),
    });
    expect(r.variablesSource).toBe("model");
    expect(r.html).toContain("Check 10482 for $2,340.00.");
  });

  it("TX: null requiredLanguage => not ready, visible UNKNOWN placeholder, no payload", async () => {
    expect(loadRules("TX").file.dueDiligence.requiredLanguage.value).toBeNull();
    const { stale } = await seedItem(t.db, { ownerState: "TX" });
    const r = await composeLetter(t.db, stale.id, { env, draftVariables: failing });
    expect(r.readiness.ready).toBe(false);
    expect(r.readiness.problems.join()).toMatch(/UNKNOWN/);
    expect(r.html).toContain(UNKNOWN_LANGUAGE_MARKER);
    expect(r.payload).toBeNull();
  });

  it("DE: bracketed date slot is filled by code (letter date + 30 days)", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "DE" });
    const r = await composeLetter(t.db, stale.id, { env, draftVariables: failing });
    expect(r.html).toContain("The State of Delaware requires us to notify you");
    expect(r.html).not.toMatch(/\[insert date/i);
    expect(r.readiness.problems).toEqual([]);
  });

  it("flags missing owner address, unknown state and missing link secret", async () => {
    const a = await seedItem(t.db, { ownerState: "CA", withAddress: false });
    const noAddr = await composeLetter(t.db, a.stale.id, { env, draftVariables: failing });
    expect(noAddr.readiness.ready).toBe(false);
    expect(noAddr.readiness.problems.join()).toMatch(/mailing address/);
    const b = await seedItem(t.db, { ownerState: null });
    const noState = await composeLetter(t.db, b.stale.id, { env, draftVariables: failing });
    expect(noState.readiness.problems.join()).toMatch(/owner state is unknown/);
    const c = await seedItem(t.db, { ownerState: "CA" });
    const noSecret = await composeLetter(t.db, c.stale.id, { env: testEnv({ OWNER_LINK_SECRET: "" }), draftVariables: failing });
    expect(noSecret.readiness.problems.join()).toMatch(/owner response link unavailable/);
  });

  it("escapes data and neutralizes merge-variable syntax", async () => {
    const { stale, company } = await seedItem(t.db, { ownerState: "CA" });
    await t.db.update(payees).set({ canonicalName: "<script>x</script> {{evil}}" }).where(eq(payees.companyId, company.id));
    const r = await composeLetter(t.db, stale.id, { env, draftVariables: failing });
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("{{evil}}");
  });

  it("recomposing reuses the same draft row and refuses once the letter was sent", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const a = await composeLetter(t.db, stale.id, { env, draftVariables: failing });
    const b = await composeLetter(t.db, stale.id, { env, draftVariables: failing });
    expect(b.outreachId).toBe(a.outreachId);
    await t.db.update(outreach).set({ status: "sent" }).where(eq(outreach.id, a.outreachId));
    await expect(composeLetter(t.db, stale.id, { env, draftVariables: failing })).rejects.toMatchObject({ name: "OutreachStateError" });
  });
});
