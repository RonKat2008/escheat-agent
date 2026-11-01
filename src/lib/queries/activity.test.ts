import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns, approvals, outreach, recoveries, reports, ruleChanges } from "@/db/schema";
import { activityDensity, buildDensity, decodeCursor, DENSITY_DAYS, encodeCursor, escapeLike, listActivity, parseActivityParams } from "./activity";
import { insertFixture, STANDARD_ITEMS } from "./test-fixtures";

let t: TestDb;
let companyId: string;
let otherId: string;
let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];
let otherIds: Awaited<ReturnType<typeof insertFixture>>["ids"];

const at = (s: string) => new Date(`${s}Z`);

beforeEach(async () => {
  t = await createTestDb();
  ({ companyId, ids } = await insertFixture(t.db, STANDARD_ITEMS));
  ({ companyId: otherId, ids: otherIds } = await insertFixture(t.db, [STANDARD_ITEMS[0]!]));

  const [appr] = await t.db
    .insert(approvals)
    .values({ action: "mail_letter", subjectId: ids.a!.staleId, payloadSha256: "ab".repeat(32), approvedBy: "ronit", approvedAt: at("2026-10-01T10:00:00"), consumedAt: at("2026-10-01T10:05:00"), createdAt: at("2026-10-01T09:59:00") })
    .returning();
  // Another company's approval, same shape.
  await t.db
    .insert(approvals)
    .values({ action: "mail_letter", subjectId: otherIds.a!.staleId, payloadSha256: "cd".repeat(32), approvedBy: "intruder", approvedAt: at("2026-10-01T11:00:00") });
  // An approval for a subject that belongs to nobody we know.
  await t.db
    .insert(approvals)
    .values({ action: "submit_report", subjectId: "00000000-0000-0000-0000-000000000000", payloadSha256: "ef".repeat(32), approvedBy: "ghost", approvedAt: at("2026-10-01T12:00:00") });

  await t.db.insert(outreach).values({ companyId, staleItemId: ids.a!.staleId, approvalId: appr!.id, channel: "letter", status: "sent", createdAt: at("2026-10-01T09:00:00"), sentAt: at("2026-10-02T09:00:00") });
  await t.db.insert(outreach).values({ companyId: otherId, staleItemId: otherIds.a!.staleId, channel: "email", status: "sent", createdAt: at("2026-10-05T09:00:00"), sentAt: at("2026-10-05T09:30:00") });
  await t.db.insert(reports).values({ companyId, state: "CA", reportYear: 2026, status: "submitted", itemCount: 2, createdAt: at("2026-10-03T08:00:00"), submittedAt: at("2026-10-04T08:00:00") });
  await t.db.insert(reports).values({ companyId: otherId, state: "CA", reportYear: 2026, status: "draft", createdAt: at("2026-10-06T08:00:00") });
  await t.db.insert(ruleChanges).values({ state: "CA", fromVersion: "v1", toVersion: "v2", diff: {}, status: "approved", reviewedBy: "counsel", reviewedAt: at("2026-10-07T08:00:00"), createdAt: at("2026-10-06T20:00:00") });
  await t.db.insert(ruleChanges).values({ state: "NY", fromVersion: "v1", toVersion: "v2", diff: {}, createdAt: at("2026-10-08T08:00:00") });
  await t.db.insert(agentRuns).values({ companyId, agent: "classifier", status: "failed", error: "boom", startedAt: at("2026-10-09T08:00:00"), finishedAt: at("2026-10-09T08:01:00") });
  await t.db.insert(agentRuns).values({ companyId: otherId, agent: "other-agent", startedAt: at("2026-10-09T09:00:00") });
  await t.db.insert(agentRuns).values({ companyId: null, agent: "system-agent", startedAt: at("2026-10-09T10:00:00") });
  await t.db.insert(recoveries).values({ companyId, state: "TX", amountCents: 123456, status: "found", foundAt: at("2026-10-10T08:00:00") });
});
afterEach(async () => {
  await t.close();
});

const titles = async (q = {}) => (await listActivity(t.db, companyId, { limit: 200, ...q })).entries;

describe("listActivity scoping", () => {
  it("never returns another company's rows, unowned approvals, or system runs", async () => {
    const all = await titles();
    const text = JSON.stringify(all);
    for (const leak of ["intruder", "ghost", "other-agent", "system-agent"]) expect(text).not.toContain(leak);
    expect(all.some((e) => e.id.includes(otherIds.a!.staleId))).toBe(false);
    // The other company sees its own approval, and not ours.
    const theirs = JSON.stringify((await listActivity(t.db, otherId, { limit: 200 })).entries);
    expect(theirs).toContain("intruder");
    expect(theirs).not.toContain("ronit");
    expect(theirs).not.toContain("classifier");
  });

  it("includes rule changes only for states the company holds", async () => {
    const rules = (await titles({ kinds: ["rule"] })).map((e) => e.title);
    expect(rules.some((x) => x.includes("CA"))).toBe(true);
    expect(rules.some((x) => x.includes("NY"))).toBe(false);
  });

  it("derives approval entries with actor, hash prefix and a link to the item", async () => {
    const [consumed, approved] = await titles({ kinds: ["approval"] });
    expect(approved).toMatchObject({ kind: "approval", actor: "ronit", payloadHash: "ab".repeat(6), title: "Approved: mail letter" });
    expect(approved!.href).toBe(`/items?item=${ids.a!.staleId}`);
    expect(consumed!.title).toBe("Approval used: mail letter");
  });

  it("links runs, reports, rules and marks failures as attention", async () => {
    const all = await titles();
    const failed = all.find((e) => e.title.startsWith("Agent run failed"));
    expect(failed).toMatchObject({ attention: true, detail: "boom" });
    expect(failed!.href).toMatch(/^\/runs\/[0-9a-f-]{36}$/);
    expect(all.find((e) => e.title.startsWith("Report submitted"))!.href).toBe("/reports?state=CA");
    const reviewed = all.find((e) => e.title.startsWith("Rule change approved"));
    expect(reviewed).toMatchObject({ actor: "counsel", href: "/rules?state=CA" });
  });

  it("summarizes ingestion rows only when ledger rows exist", async () => {
    const ing = await titles({ kinds: ["ingestion"] });
    expect(ing).toHaveLength(1);
    expect(ing[0]!.title).toBe(`Ingested ${STANDARD_ITEMS.length} ledger rows`);
    const empty = await createTestDb();
    const { companyId: lonely } = await insertFixture(empty.db, []);
    expect((await listActivity(empty.db, lonely)).entries).toEqual([]);
    await empty.close();
  });
});

describe("ordering and pagination", () => {
  it("is strictly newest first with unique ids", async () => {
    const all = await titles();
    const times = all.map((e) => e.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it("pages with a cursor without gaps or duplicates", async () => {
    const full = await titles();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listActivity(t.db, companyId, { limit: 3, cursor });
      expect(page.entries.length).toBeLessThanOrEqual(3);
      seen.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    expect(seen).toEqual(full.map((e) => e.id));
    expect(pages).toBeGreaterThan(1);
  });

  it("returns no cursor on the last page and clamps the limit", async () => {
    expect((await listActivity(t.db, companyId, { limit: 200 })).nextCursor).toBeNull();
    expect((await listActivity(t.db, companyId, { limit: 0 })).entries.length).toBeGreaterThan(0);
    expect((await listActivity(t.db, companyId, { limit: 100000 })).entries.length).toBeLessThanOrEqual(200);
  });

  it("ignores a malformed cursor instead of failing", async () => {
    const first = await listActivity(t.db, companyId, { limit: 2 });
    const bad = await listActivity(t.db, companyId, { limit: 2, cursor: "not-a-cursor" });
    expect(bad.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
  });
});

describe("filters", () => {
  it("filters by kind (single and multiple)", async () => {
    expect((await titles({ kinds: ["run"] })).every((e) => e.kind === "run")).toBe(true);
    const two = await titles({ kinds: ["run", "recovery"] });
    expect(new Set(two.map((e) => e.kind))).toEqual(new Set(["run", "recovery"]));
  });

  it("filters by state", async () => {
    const tx = await titles({ state: "TX" });
    expect(tx.length).toBeGreaterThan(0);
    expect(tx.every((e) => e.state === "TX")).toBe(true);
  });

  it("filters by inclusive UTC date range", async () => {
    const day = await titles({ from: "2026-10-04", to: "2026-10-04" });
    expect(day.map((e) => e.title)).toEqual(["Report submitted: CA 2026"]);
    const from = await titles({ from: "2026-10-09" });
    expect(from.every((e) => e.at >= at("2026-10-09T00:00:00"))).toBe(true);
    const to = await titles({ to: "2026-10-01" });
    expect(to.every((e) => e.at < at("2026-10-02T00:00:00"))).toBe(true);
  });

  it("matches free text across title, actor and hash, case-insensitively, and treats % and _ literally", async () => {
    expect((await titles({ q: "COUNSEL" })).map((e) => e.kind)).toEqual(["rule"]);
    expect((await titles({ q: "abababab" })).every((e) => e.kind === "approval")).toBe(true);
    expect(await titles({ q: "%" })).toEqual([]);
    expect(await titles({ q: "no such thing" })).toEqual([]);
    expect((await titles({ q: "boom" })).length).toBe(1);
  });

  it("combines filters with pagination", async () => {
    const p1 = await listActivity(t.db, companyId, { kinds: ["approval", "run"], limit: 2 });
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listActivity(t.db, companyId, { kinds: ["approval", "run"], limit: 2, cursor: p1.nextCursor });
    expect([...p1.entries, ...p2.entries].every((e) => ["approval", "run"].includes(e.kind))).toBe(true);
    expect(p2.entries.map((e) => e.id)).not.toContain(p1.entries[0]!.id);
  });
});

describe("helpers", () => {
  it("round-trips cursors and rejects garbage", () => {
    const c = encodeCursor("2026-10-01T10:00:00.123456Z", "run:abc:started");
    expect(decodeCursor(c)).toEqual({ atIso: "2026-10-01T10:00:00.123456Z", uid: "run:abc:started" });
    expect(decodeCursor("%%%")).toBeNull();
    expect(decodeCursor(encodeCursor("yesterday", "x"))).toBeNull();
    expect(decodeCursor(encodeCursor("2026-10-01T10:00:00.123456Z", "a b'; drop"))).toBeNull();
  });

  it("escapes LIKE metacharacters", () => {
    expect(escapeLike("50%_\\")).toBe("50\\%\\_\\\\");
  });

  it("drops malformed URL params", () => {
    expect(parseActivityParams({ kind: "run,bogus", state: "ca", from: "2026-13-45", to: "2026-10-02", q: " x " })).toEqual({
      kinds: ["run"],
      state: "CA",
      to: "2026-10-02",
      q: "x",
    });
    expect(parseActivityParams({ state: "CAL" })).toEqual({});
  });
});

describe("day density", () => {
  it("buildDensity fills gaps, keeps the window inclusive and ignores days outside it", () => {
    const d = buildDensity(
      [
        { day: "2026-10-03", count: 2, attention: 1 },
        { day: "2026-10-01", count: 5, attention: 0 },
        { day: "2026-09-01", count: 9, attention: 0 },
      ],
      "2026-10-03",
      3,
    );
    expect(d.from).toBe("2026-10-01");
    expect(d.to).toBe("2026-10-03");
    expect(d.days).toEqual([
      { day: "2026-10-01", count: 5, attention: 0 },
      { day: "2026-10-02", count: 0, attention: 0 },
      { day: "2026-10-03", count: 2, attention: 1 },
    ]);
    expect(d.total).toBe(7);
    expect(d.peak?.day).toBe("2026-10-01");
  });

  it("buildDensity reports no peak for an empty window and crosses month and year ends", () => {
    const d = buildDensity([], "2027-01-02", 5);
    expect(d.days.map((x) => x.day)).toEqual(["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(d.total).toBe(0);
    expect(d.peak).toBeNull();
    expect(buildDensity([], "2026-10-03").days).toHaveLength(DENSITY_DAYS);
  });

  it("counts the same rows the list shows, per UTC day, ending at the newest matching day", async () => {
    const runs = await activityDensity(t.db, companyId, { kinds: ["run"] });
    expect(runs.to).toBe("2026-10-09");
    expect(runs.days.at(-1)).toEqual({ day: "2026-10-09", count: 2, attention: 1 });
    expect(runs.total).toBe((await titles({ kinds: ["run"] })).length);
  });

  it("ends at the to filter and honours state and text filters, never another company's rows", async () => {
    const d = await activityDensity(t.db, companyId, { kinds: ["approval", "outreach", "report"], to: "2026-10-04" });
    expect(d.to).toBe("2026-10-04");
    const byDay = Object.fromEntries(d.days.filter((x) => x.count > 0).map((x) => [x.day, x.count]));
    expect(byDay).toEqual({ "2026-10-01": 3, "2026-10-02": 1, "2026-10-03": 1, "2026-10-04": 1 });
    expect((await activityDensity(t.db, companyId, { q: "no such thing" }, "2026-10-20")).total).toBe(0);
    expect((await activityDensity(t.db, companyId, { q: "no such thing" }, "2026-10-20")).to).toBe("2026-10-20");
    // The other company has exactly one run of its own (started, never finished); ours never leak into its strip.
    const theirs = await activityDensity(t.db, otherId, { kinds: ["run"] }, "2026-10-20");
    expect(theirs.total).toBe(1);
  });
});
