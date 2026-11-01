import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns, approvals, outreach, reports, ruleChanges, staleItems } from "@/db/schema";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValuesFor } from "@/lib/rules/values";
import type { ClosePlan, CloseStepId } from "@/lib/chat/ui-types";
import { buildClosePlan, ClosePlanError, letterState } from "./plan";

const CA_ITEMS: FixtureItem[] = [
  { key: "p1", check: "71001", payee: "Bayline Electric", cents: 100_000, issueDate: "2025-01-01", state: "CA", status: "dd_pending", ddStart: "2026-10-01", ddEnd: "2026-12-01", report: "2027-06-30", remit: "2027-06-30" },
  { key: "p2", check: "71002", payee: "Coastal Paper", cents: 20_000, issueDate: "2025-01-02", state: "CA", status: "dd_pending", unverified: true, ddStart: "2026-10-01", ddEnd: "2026-12-15", report: "2027-06-30" },
  { key: "s1", check: "71003", payee: "Golden Gate Tile", cents: 5_000, issueDate: "2025-01-03", state: "CA", status: "dd_sent", ddEnd: "2026-11-20", report: "2027-06-30" },
  { key: "r1", check: "71004", payee: "Sierra Lumber", cents: 30_000, issueDate: "2024-01-01", state: "CA", status: "to_report", report: "2026-11-30", remit: "2026-11-30" },
  { key: "w1", check: "71005", payee: "Not Yet Co", cents: 9_999, issueDate: "2025-09-01", state: "CA", status: "watching" },
  { key: "t1", check: "72001", payee: "Lone Star Supply", cents: 99_999, issueDate: "2024-01-01", state: "TX", status: "to_report", remit: "2026-11-01" },
];

let t: TestDb;
let companyId: string;
let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  const f = await insertFixture(t.db, CA_ITEMS);
  companyId = f.companyId;
  ids = f.ids;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

const plan = () => buildClosePlan(t.db, companyId, "CA");
const stepOf = (p: ClosePlan, id: CloseStepId) => {
  const s = p.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
};
const letter = (key: string, status: "draft" | "awaiting_approval" | "approved" | "sent" | "cancelled", ready = true) =>
  t.db.insert(outreach).values({ companyId, staleItemId: ids[key]!.staleId, channel: "letter", status, tracking: { compose: { readiness: { ready, problems: ready ? [] : ["Missing address"] } } } });
const report = (status: "draft" | "validated" | "awaiting_approval" | "approved" | "submitted" | "confirmed" | "failed", over: Partial<typeof reports.$inferInsert> = {}) =>
  t.db
    .insert(reports)
    .values({ companyId, state: "CA", reportYear: 2026, status, itemCount: 1, totalCents: 30_000, checksum: "abc", validationErrors: [], ...over })
    .returning()
    .then((r) => r[0]!);

const caUnverified = () => {
  const rules = tryLoadRules("CA")!;
  return new Set(listRuleValuesFor(rules.file, "vendor_check").filter((v) => !v.rv.verified).map((v) => v.path)).size;
};

describe("close-out plan: fresh cycle", () => {
  it("orders eight steps and derives each status from the records", async () => {
    const p = await plan();
    expect(p.steps.map((s) => s.id)).toEqual(["letters_draft", "letters_approve", "letters_send", "rules_verify", "report_generate", "report_approve", "report_submit", "remit"]);
    expect(stepOf(p, "letters_draft")).toMatchObject({ status: "ready", count: 2, amountCents: 120_000, unverified: true, action: { kind: "draft_letters", label: "Draft 2 letters" } });
    expect(stepOf(p, "letters_approve")).toMatchObject({ status: "blocked", blockedReason: "Draft the letters first.", href: "/approvals" });
    expect(stepOf(p, "letters_send")).toMatchObject({ status: "blocked", blockedReason: "Letters can be sent only after you approve them." });
    expect(stepOf(p, "report_generate")).toMatchObject({ status: "ready", count: 1, amountCents: 30_000, href: "/reports?state=CA", action: { kind: "generate_report" } });
    expect(stepOf(p, "report_approve")).toMatchObject({ status: "blocked", blockedReason: "Needs a current, validated report first." });
    expect(stepOf(p, "report_submit")).toMatchObject({ status: "blocked", action: null });
    expect(stepOf(p, "remit")).toMatchObject({ status: "blocked", amountCents: 30_000, href: "/items?state=CA&status=reported" });
    expect(stepOf(p, "remit").blockedReason).toBe("Remittance follows the submitted report. Due Nov 30, 2026.");
    expect(p.nextStepId).toBe("letters_draft");
  });

  it("totals money at stake for the state's cycle only (watching items and other states excluded)", async () => {
    const p = await plan();
    expect(p).toMatchObject({ state: "CA", stateName: "California", asOf: "2026-11-01", itemCount: 4, atStakeCents: 155_000, total: 8 });
    expect(p.reportDue).toEqual({ date: "2026-11-30", unverified: true });
    expect(p.remitDue).toEqual({ date: "2026-11-30", unverified: true });
    expect(p.done).toBe(p.steps.filter((s) => s.status === "done").length);
  });

  it("asks a person to verify exactly the unverified rule values for this cycle's property types", async () => {
    const expected = caUnverified();
    const s = stepOf(await plan(), "rules_verify");
    expect(s.href).toBe("/rules?state=CA");
    if (expected === 0) expect(s.status).toBe("done");
    else expect(s).toMatchObject({ status: "needs_approval", count: 1, unverified: true, amountCents: 20_000, action: null });
    if (expected) expect(s.detail).toContain(`${expected} rule value${expected === 1 ? "" : "s"} this cycle relies on`);
  });

  it("counts proposed rule changes for the state as needing review", async () => {
    await t.db.insert(ruleChanges).values({ state: "CA", diff: {}, status: "proposed" });
    await t.db.insert(ruleChanges).values({ state: "TX", diff: {}, status: "proposed" });
    const s = stepOf(await plan(), "rules_verify");
    expect(s).toMatchObject({ status: "needs_approval", count: 1 });
    expect(s.detail).toContain("1 rule change awaits review");
  });

  it("blocks the report with the engine's next window-close date when nothing is To Report", async () => {
    await t.db.update(staleItems).set({ status: "dd_sent" }).where(eq(staleItems.id, ids.r1!.staleId));
    const s = stepOf(await plan(), "report_generate");
    expect(s).toMatchObject({ status: "blocked", action: null });
    expect(s.blockedReason).toBe("No CA items are To Report yet. The earliest due-diligence window closes Nov 20, 2026.");
  });
});

describe("close-out plan: letters", () => {
  it("drafted letters move the gate to the human approval", async () => {
    await letter("p1", "draft");
    await letter("p2", "awaiting_approval");
    const p = await plan();
    expect(stepOf(p, "letters_draft")).toMatchObject({ status: "done", action: null });
    expect(stepOf(p, "letters_approve")).toMatchObject({ status: "needs_approval", count: 2, amountCents: 120_000, href: "/approvals", action: null });
    expect(stepOf(p, "letters_send").status).toBe("blocked");
    expect(p.nextStepId).toBe("letters_approve");
  });

  it("a draft with readiness problems blocks approval with the reason", async () => {
    await letter("p1", "draft", false);
    await letter("p2", "draft");
    const s = stepOf(await plan(), "letters_approve");
    expect(s).toMatchObject({ status: "blocked", count: 1, amountCents: 100_000, blockedReason: "1 draft has problems to fix before approval." });
  });

  it("approved letters wait for the person to send them; sent letters complete the step", async () => {
    await letter("p1", "approved");
    await letter("p2", "sent");
    let p = await plan();
    expect(stepOf(p, "letters_approve").status).toBe("done");
    expect(stepOf(p, "letters_send")).toMatchObject({ status: "needs_approval", count: 1, amountCents: 100_000, action: null });
    await t.db.update(outreach).set({ status: "sent" }).where(eq(outreach.staleItemId, ids.p1!.staleId));
    p = await plan();
    expect(stepOf(p, "letters_send")).toMatchObject({ status: "done", count: 3, detail: "3 letters sent." });
  });

  it("an item whose only letter was cancelled is blocked, not silently done", async () => {
    await letter("p1", "cancelled");
    await letter("p2", "draft");
    const s = stepOf(await plan(), "letters_draft");
    expect(s.status).toBe("blocked");
    expect(s.blockedReason).toMatch(/cancelled or failed letter/);
    expect(stepOf(await plan(), "letters_send").status).toBe("blocked");
    await t.db.update(outreach).set({ status: "sent" }).where(eq(outreach.staleItemId, ids.p2!.staleId));
    const p = await plan();
    expect(stepOf(p, "letters_approve")).toMatchObject({ status: "blocked", count: 1, blockedReason: "Draft the letters first." });
    expect(stepOf(p, "letters_send").status).toBe("blocked");
    expect(letterState([{ status: "cancelled" }, { status: "failed" }])).toBe("none");
  });
});

describe("close-out plan: report, filing and remittance", () => {
  it("a validated report that matches the pool is done and needs the person's approval next", async () => {
    await report("validated");
    const p = await plan();
    expect(stepOf(p, "report_generate")).toMatchObject({ status: "done", amountCents: 30_000 });
    expect(stepOf(p, "report_approve")).toMatchObject({ status: "needs_approval", href: "/reports?state=CA", action: null });
    expect(stepOf(p, "report_submit")).toMatchObject({ status: "needs_approval", href: "/reports?state=CA", action: null });
  });

  it("a validated report that no longer matches the pool can be regenerated", async () => {
    await report("validated", { itemCount: 2, totalCents: 45_000 });
    const p = await plan();
    expect(stepOf(p, "report_generate")).toMatchObject({ status: "ready", action: { kind: "generate_report", label: "Regenerate and validate" } });
    expect(stepOf(p, "report_generate").detail).toMatch(/^Out of date/);
    expect(stepOf(p, "report_approve").status).toBe("blocked");
  });

  it("never offers to regenerate an out-of-date file while the filing agent works on it", async () => {
    const r = await report("validated", { itemCount: 2, totalCents: 45_000 });
    await t.db.insert(agentRuns).values({ companyId, agent: "filing_agent", status: "running", input: { reportId: r.id, state: "CA" }, output: {} });
    const s = stepOf(await plan(), "report_generate");
    expect(s).toMatchObject({ status: "blocked", action: null });
    expect(s.blockedReason).toMatch(/filing agent is working on this file/);
  });

  it("an approved file stays done but says when newer To Report items are not in it", async () => {
    await report("approved", { itemCount: 0, totalCents: 0 });
    const s = stepOf(await plan(), "report_generate");
    expect(s).toMatchObject({ status: "done", action: null });
    expect(s.detail).toContain("1 item reached To Report after it was made and is not in it.");
  });

  it("validation errors block the report with the error count", async () => {
    await report("draft", { validationErrors: [{ severity: "error", message: "x" }, { severity: "error", message: "y" }, { severity: "warning", message: "z" }] });
    const s = stepOf(await plan(), "report_generate");
    expect(s).toMatchObject({ status: "blocked", action: null });
    expect(s.blockedReason).toBe("The last file has 2 validation errors. Fix them in Reports, then regenerate.");
  });

  it("a report awaiting approval links to its exact approval gate and is never regenerated", async () => {
    const r = await report("awaiting_approval");
    const p = await plan();
    expect(stepOf(p, "report_generate")).toMatchObject({ status: "done", action: null });
    expect(stepOf(p, "report_approve")).toMatchObject({ status: "needs_approval", href: `/approvals?sel=${encodeURIComponent(`r:${r.id}`)}` });
  });

  it("reflects the filing run: running, paused at the gate, or failed", async () => {
    const r = await report("approved");
    const [run] = await t.db
      .insert(agentRuns)
      .values({ companyId, agent: "filing_agent", status: "running", input: { reportId: r.id, state: "CA" }, output: { phase: "filling" } })
      .returning();
    let s = stepOf(await plan(), "report_submit");
    expect(s).toMatchObject({ status: "running", href: `/runs/${run!.id}` });
    await t.db.update(agentRuns).set({ output: { phase: "awaiting_approval" } }).where(eq(agentRuns.id, run!.id));
    expect(stepOf(await plan(), "report_submit").status).toBe("needs_approval");
    await t.db.update(agentRuns).set({ status: "failed", error: "Portal timed out" }).where(eq(agentRuns.id, run!.id));
    s = stepOf(await plan(), "report_submit");
    expect(s).toMatchObject({ status: "blocked" });
    expect(s.blockedReason).toContain("Portal timed out");
    expect(stepOf(await plan(), "report_approve").status).toBe("done");
  });

  it("after submission the reported items need remitting, then the cycle is done", async () => {
    await report("submitted", { replicaConfirmation: "CA-123" });
    await t.db.update(staleItems).set({ status: "reported" }).where(eq(staleItems.id, ids.r1!.staleId));
    let p = await plan();
    expect(stepOf(p, "report_generate").status).toBe("done");
    expect(stepOf(p, "report_approve").status).toBe("done");
    expect(stepOf(p, "report_submit")).toMatchObject({ status: "done", detail: "Submitted to the replica CA portal, confirmation CA-123." });
    expect(stepOf(p, "remit")).toMatchObject({ status: "needs_approval", amountCents: 30_000, count: 1, action: null });
    expect(stepOf(p, "remit").detail).toContain("nothing is paid from here");
    // Filed money is counted from the submitted report's own snapshot.
    expect(p.atStakeCents).toBe(125_000 + 30_000);
    await t.db.update(staleItems).set({ status: "remitted" }).where(eq(staleItems.id, ids.r1!.staleId));
    p = await plan();
    expect(stepOf(p, "remit").status).toBe("done");
  });

  it("never offers an action for an irreversible step", async () => {
    for (const status of ["validated", "awaiting_approval", "approved", "submitted"] as const) {
      await t.db.delete(reports);
      await report(status);
      const p = await plan();
      for (const id of ["letters_approve", "letters_send", "rules_verify", "report_approve", "report_submit", "remit"] as const) {
        expect(stepOf(p, id).action, `${status}/${id}`).toBeNull();
      }
    }
  });
});

describe("close-out plan: scoping, idempotence, input", () => {
  it("ignores another company's items, letters and reports", async () => {
    const other = await insertFixture(t.db, [
      { key: "x", check: "99001", payee: "Other Co Payee", cents: 777_777, issueDate: "2024-01-01", state: "CA", status: "reported" },
    ]);
    await t.db.insert(reports).values({ companyId: other.companyId, state: "CA", reportYear: 2026, status: "submitted", itemCount: 1, totalCents: 777_777 });
    const p = await plan();
    expect(p.atStakeCents).toBe(155_000);
    expect(stepOf(p, "report_generate")).toMatchObject({ status: "ready", amountCents: 30_000 });
    expect(stepOf(p, "report_submit").status).toBe("blocked");
    const theirs = await buildClosePlan(t.db, other.companyId, "ca");
    expect(theirs.atStakeCents).toBe(777_777);
  });

  it("is idempotent and read-only", async () => {
    await letter("p1", "draft");
    const counts = async () => ({
      outreach: (await t.db.select().from(outreach)).length,
      reports: (await t.db.select().from(reports)).length,
      approvals: (await t.db.select().from(approvals)).length,
      runs: (await t.db.select().from(agentRuns)).length,
    });
    const before = await counts();
    const a = await plan();
    const b = await plan();
    expect(b).toEqual(a);
    expect(await counts()).toEqual(before);
  });

  it("refuses states without a close-out plan", async () => {
    await expect(buildClosePlan(t.db, companyId, "NY")).rejects.toBeInstanceOf(ClosePlanError);
  });
});
