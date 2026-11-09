/**
 * Approving from an Ask card is the SAME act as approving on the Approvals / Ledger pages.
 *
 * Against the SYNTHETIC demo seed, with one pending letter (#10087) and one generated CA report:
 *  1. Request identity: for every row the review card offers to approve, the request it sends (URL and body) is
 *     byte-identical to what the page component sends for the same row, built from the page's own data source
 *     (loadQueue for Approvals/OutreachDetail.tsx + OtherDetails.tsx; closePreviews for Ledger/ClosePackButton.tsx).
 *     The filing card's report approval and the close card's close request match too.
 *  2. Effect identity: the database is cloned after setup (PGlite clone, so every id is the same). The CARD request runs
 *     on one copy and the PAGE request on the other, through the real route handlers, at the same instant. The approval
 *     rows and the audit-chain events they append are identical (only the approval row's own random id differs), and
 *     both chains still verify.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { approvals, auditChain, ledgerItems, staleItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { verifyChain } from "@/lib/audit/chain-db";
import { resetClock } from "@/lib/clock";
import { closePreviews } from "@/lib/close-pack/close";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { draftOutreach } from "@/lib/outreach/draft";
import { TEST_SECRET } from "@/lib/outreach/testing";
import { loadLedger } from "@/lib/queries/ledger";
import { generateStateReport } from "@/lib/reports/service";
import { syncRulesToDb } from "@/lib/rules/load";
import { buildBundle } from "@/lib/synthetic/build";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { seedDemo } from "@/lib/synthetic/seed";
import { loadQueue, type QueueEntry, type QueueKind } from "@/app/(app)/approvals/queue-data";
import type { ChatToolContext } from "@/lib/chat/tools/define";
import { approvalRequest, closeRequest, type ApprovalRequest } from "./approval-request";
import type { ApprovalsReviewUi, FilingCardUi, PeriodCloseUi, ReviewRow } from "./approval-ui-types";
import { executeAskCardTool } from "./tools";

/** The route handlers read the DB through these; each test points them at one copy. */
let current: Db;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => current }));
vi.mock("@/db/client", async (orig) => ({ ...(await orig<typeof import("@/db/client")>()), getDb: async () => current }));
// Never reach a model: the letter composer falls back to its template.
vi.mock("@/lib/agents/letter-writer", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/letter-writer")>()),
  draftLetterVariables: async () => {
    const { AnthropicNotConfigured } = await import("@/lib/llm/errors");
    throw new AnthropicNotConfigured();
  },
}));

const { POST: approveOutreachPost } = await import("@/app/api/outreach/[id]/approve/route");
const { POST: approveReportPost } = await import("@/app/api/reports/[id]/approve/route");
const { POST: closePost } = await import("@/app/api/close-pack/route");

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));
const APPROVER = "Dana Reviewer";
const AT = new Date("2026-11-09T17:00:00.000Z");

let pgA: PGlite;
let pgB: PGlite;
let A: Db;
let B: Db;
let companyId: string;
let reportDir: string;
const saved: Record<string, string | undefined> = {};

async function freshDb(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { pg, db };
}

beforeAll(async () => {
  for (const k of ["DEMO_ANCHOR_DATE", "DEMO_MODE", "OWNER_LINK_SECRET", "APP_BASE_URL", "APP_PASSCODE", "ANTHROPIC_API_KEY"]) saved[k] = process.env[k];
  process.env.DEMO_ANCHOR_DATE = DEMO_ANCHOR_DATE;
  process.env.DEMO_MODE = "1";
  process.env.OWNER_LINK_SECRET = TEST_SECRET;
  process.env.APP_BASE_URL = "https://escheat.test";
  process.env.APP_PASSCODE = "";
  process.env.ANTHROPIC_API_KEY = "";
  ({ pg: pgA, db: A } = await freshDb());
  const bundle = buildBundle();
  await seedDemo(A, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  await syncRulesToDb(A);
  companyId = (await resolveCompanyId(A))!;
  await resetClock(A, companyId);
  await detectStaleItems(A, companyId, { classify });
  // A letter waiting for approval (#10087's window is open on the demo date) and a generated CA report.
  const [item] = await A.select({ id: staleItems.id })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(ledgerItems.referenceNumber, "10087"));
  await draftOutreach(A, item!.id, "letter");
  reportDir = mkdtempSync(path.join(tmpdir(), "askapprove-"));
  await generateStateReport(A, companyId, "CA", { dataDir: reportDir });
  pgB = (await pgA.clone()) as PGlite;
  B = drizzle(pgB, { schema }) as unknown as Db;
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pgA?.close();
  await pgB?.close();
  if (reportDir) rmSync(reportDir, { recursive: true, force: true });
});

const ctxOf = (db: Db): ChatToolContext => ({ db, companyId });

/** What approvals/OutreachDetail.tsx and approvals/OtherDetails.tsx POST for a queue entry (letters need no `to`). */
function pageRequest(e: QueueEntry<QueueKind>, acknowledged: boolean): ApprovalRequest {
  if (e.outreach) return { url: `/api/outreach/${e.outreach.id}/approve`, body: { approvedBy: APPROVER, expectedContentSha256: e.outreach.contentSha256 } };
  if (e.report) {
    const r = e.report;
    return {
      url: `/api/reports/${r.id}/approve`,
      body: {
        approvedBy: APPROVER,
        expectedChecksum: r.checksum ?? "",
        acknowledgedUnverified: acknowledged ? r.unverifiedCount : null,
        acknowledgedUnsent: acknowledged ? r.unsentCount : null,
      },
    };
  }
  if (e.claim) return { url: `/api/recoveries/${e.claim.id}/approve`, body: { approvedBy: APPROVER, expectedPayloadSha256: e.claim.payloadSha256 } };
  throw new Error(`no page approval for ${e.key}`);
}

async function reviewRows(db: Db): Promise<ReviewRow[]> {
  const r = await executeAskCardTool("review_approvals", {}, ctxOf(db));
  if (!r.ok || r.ui.kind !== "approvals_review") throw new Error("expected the review card");
  return (r.ui.props as ApprovalsReviewUi["props"]).groups.flatMap((g) => g.rows);
}

/** Runs a request through the real route handler, against `db`, at the fixed instant. */
async function post(db: Db, req: ApprovalRequest): Promise<Response> {
  current = db;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT);
  try {
    const request = new Request(`http://x${req.url}`, { method: "POST", body: JSON.stringify(req.body) });
    const outreachId = /^\/api\/outreach\/([^/]+)\/approve$/.exec(req.url)?.[1];
    const reportId = /^\/api\/reports\/([^/]+)\/approve$/.exec(req.url)?.[1];
    if (outreachId) return await approveOutreachPost(request, { params: Promise.resolve({ id: outreachId }) });
    if (reportId) return await approveReportPost(request, { params: Promise.resolve({ id: reportId }) });
    if (req.url === "/api/close-pack") return await closePost(request);
    throw new Error(`unexpected url ${req.url}`);
  } finally {
    vi.useRealTimers();
  }
}

/** Approval rows and audit events, with only the approval row's own random id (and the hashes that cover it) masked. */
async function record(db: Db) {
  const rows = await db.select().from(approvals).orderBy(asc(approvals.action), asc(approvals.subjectId));
  const ids = new Map(rows.map((r, i) => [r.id, `<approval ${i}>`]));
  const mask = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null), (_k, x) => (typeof x === "string" && ids.has(x) ? ids.get(x) : x));
  const events = await db.select().from(auditChain).where(eq(auditChain.companyId, companyId)).orderBy(asc(auditChain.seq));
  return {
    approvals: rows.map((r) => mask(r)),
    // hash/prevHash chain over the approval ids, so they are the one thing allowed to differ (both chains verify below).
    events: events.map((e) => mask({ seq: e.seq, occurredAt: e.occurredAt, kind: e.kind, subjectType: e.subjectType, subjectId: e.subjectId, payload: JSON.parse(e.payload) as unknown })),
  };
}

describe("Ask approval card tools (real data)", () => {
  it("build from real rows; ids, hashes and companyId ride in ui only, never in the model data", async () => {
    const ctx = ctxOf(A);
    const calls: [string, Record<string, unknown>][] = [
      ["review_approvals", {}],
      ["prepare_outreach", {}],
      ["prepare_outreach", { item: "10087" }],
      ["prepare_period_close", { month: "october" }],
      ["prepare_filing", { state: "CA" }],
    ];
    const queue = await loadQueue(A, companyId);
    const secrets = [companyId, ...queue.entries.flatMap((e) => [e.outreach?.id, e.outreach?.contentSha256, e.report?.id, e.report?.checksum].filter((x): x is string => !!x))];
    for (const [name, input] of calls) {
      const r = await executeAskCardTool(name, input, ctx);
      expect(r.ok, `${name} ${JSON.stringify(r.ok ? "" : r.error)}`).toBe(true);
      if (!r.ok) continue;
      const data = JSON.stringify(r.data);
      for (const s of secrets) expect(data, `${name} leaks ${s}`).not.toContain(s);
      expect(data).not.toMatch(/[0-9a-f]{64}/);
    }
    const review = await executeAskCardTool("review_approvals", {}, ctx);
    const props = review.ok && review.ui.kind === "approvals_review" ? (review.ui.props as ApprovalsReviewUi["props"]) : null;
    expect(props?.total).toBe(queue.entries.filter((e) => e.actionable && e.statusKey !== "approved" && (!e.outreach || ["draft", "awaiting_approval"].includes(e.outreach.status))).length);
    const letter = props!.groups.find((g) => g.kind === "letter")!.rows[0]!;
    expect(letter.bodyText).toBeTruthy();
    expect(letter.irreversible).toMatch(/Lob test mode/);
    const drafts = await executeAskCardTool("prepare_outreach", { item: "#10087" }, ctx);
    expect(drafts.ok && drafts.ui.kind === "outreach_drafts" && drafts.ui.props.drafts.length).toBe(1);
    expect(drafts.ok && drafts.ui.kind === "outreach_drafts" && drafts.ui.props.drafts[0]!.bodyText).toBe(letter.bodyText);
    const close = await executeAskCardTool("prepare_period_close", { month: "october" }, ctx);
    const cp = close.ok && close.ui.kind === "period_close" ? (close.ui.props as PeriodCloseUi["props"]) : null;
    expect(cp?.period).toBe("2026-10");
    expect(cp?.tieOut?.states.map((s) => s.state)).toEqual(expect.arrayContaining(["CA", "DE", "TX"]));
    expect(cp?.tieOut?.states.find((s) => s.state === "CA")?.unverifiedRules).toBeGreaterThan(0);
    expect((await executeAskCardTool("prepare_filing", { state: "NY" }, ctx)).ok).toBe(false);
    expect((await executeAskCardTool("prepare_outreach", { item: "Nobody By This Name" }, ctx)).ok).toBe(false);
  });
});

describe("Ask approval cards approve exactly like the pages", () => {
  it("request identity: every approvable card row sends the page's endpoint, body and hash", async () => {
    const rows = await reviewRows(A);
    const queue = await loadQueue(A, companyId);
    const approvable = rows.filter((r) => r.approve !== null);
    expect(approvable.map((r) => r.kind)).toEqual(expect.arrayContaining(["letter", "report"]));
    for (const row of approvable) {
      const entry = queue.entries.find((e) => e.key === row.key)!;
      for (const ack of [false, true]) expect(approvalRequest(row.approve!, `  ${APPROVER} `, ack), row.key).toEqual(pageRequest(entry, ack));
    }
    // The filing card's report approval is the same request as the review card's (and the Approvals page's).
    const filing = await executeAskCardTool("prepare_filing", { state: "CA" }, ctxOf(A));
    if (!filing.ok || filing.ui.kind !== "filing") throw new Error("expected the filing card");
    const fa = (filing.ui.props as FilingCardUi["props"]).report?.approve;
    expect(fa).toBeTruthy();
    const reportRow = approvable.find((r) => r.kind === "report")!;
    expect(approvalRequest(fa!, APPROVER, true)).toEqual(pageRequest(queue.entries.find((e) => e.key === reportRow.key)!, true));
  });

  it("effect identity: card on one copy, page on the other -> the same approval rows and audit-chain events", async () => {
    const before = await record(A);
    expect(before).toEqual(await record(B));

    const cardRows = (await reviewRows(A)).filter((r) => r.approve !== null);
    const queueB = await loadQueue(B, companyId);
    for (const row of cardRows) {
      const viaCard = await post(A, approvalRequest(row.approve!, APPROVER, true));
      const viaPage = await post(B, pageRequest(queueB.entries.find((e) => e.key === row.key)!, true));
      expect(viaCard.status, row.key).toBe(201);
      expect(viaPage.status, row.key).toBe(201);
    }

    const a = await record(A);
    const b = await record(B);
    expect(a.approvals.length).toBe(before.approvals.length + cardRows.length);
    expect(a.approvals).toEqual(b.approvals);
    expect(a.events).toEqual(b.events);
    const granted = a.events.filter((e) => (e as { kind: string }).kind === "approval.granted");
    expect(granted.length).toBeGreaterThanOrEqual(cardRows.length);
    expect((await verifyChain(A, companyId)).ok).toBe(true);
    expect((await verifyChain(B, companyId)).ok).toBe(true);
    // Approving sent and filed nothing: the letter is approved (not sent), the report approved (not submitted).
    const after = await reviewRows(A);
    expect(after.filter((r) => r.approve !== null)).toHaveLength(0);
  });

  it("close identity: the close card's request is the Ledger button's, and closing through it records the same approval", async () => {
    const card = await executeAskCardTool("prepare_period_close", { period: "2026-10" }, ctxOf(A));
    if (!card.ok || card.ui.kind !== "period_close") throw new Error("expected the close card");
    const p = card.ui.props as PeriodCloseUi["props"];
    expect(p.status).toBe("open");
    const ledgerPreview = closePreviews(await loadLedger(B, companyId), ["2026-10"])["2026-10"]!;
    // ledger/ClosePackButton.tsx: { period: month, approvedBy: approver, expectedJournalSha256: preview.journalSha256 }
    const page: ApprovalRequest = { url: "/api/close-pack", body: { period: "2026-10", approvedBy: APPROVER, expectedJournalSha256: ledgerPreview.journalSha256 } };
    expect(closeRequest(p.period, APPROVER, p.preview!.journalSha256)).toEqual(page);

    expect((await post(A, closeRequest(p.period, APPROVER, p.preview!.journalSha256))).status).toBe(201);
    expect((await post(B, page)).status).toBe(201);
    const a = await record(A);
    const b = await record(B);
    const closeA = a.approvals.filter((r) => (r as { action: string }).action === "close_period");
    expect(closeA).toHaveLength(1);
    expect(closeA).toEqual(b.approvals.filter((r) => (r as { action: string }).action === "close_period"));
    const kinds = (x: typeof a) => x.events.map((e) => (e as { kind: string }).kind);
    expect(kinds(a)).toEqual(kinds(b));
    expect(kinds(a)).toContain("period.closed");

    // The same month is now closed on the card, with its frozen pack.
    const again = await executeAskCardTool("prepare_period_close", { period: "2026-10" }, ctxOf(A));
    expect(again.ok && again.ui.kind === "period_close" && (again.ui.props as PeriodCloseUi["props"]).status).toBe("closed");
    // A second close is refused by the server (409), not by the card.
    expect((await post(A, closeRequest(p.period, APPROVER, p.preview!.journalSha256))).status).toBe(409);
  });
});
