/**
 * Server tools behind the Ask approval-class cards (docs/ASK-MODE.md slice 4). Like the slice 3 card tools they are
 * reached only through the deterministic intents (./intent.ts), with no model, and are NOT in CHAT_TOOLS.
 *
 * Invariants (tested): `writes: false`; no name starts with approve_/send_/file_/submit_/pay_/close_period_/adopt_;
 * `data` never carries ids, hashes or companyId (those ride in `ui` only, so the card can call the EXISTING approval
 * endpoint with the hash the person saw). None of them approves, sends, files or closes anything: the person does, on
 * the card, through the same server routes as the Approvals, Reports and Ledger pages.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { reports } from "@/db/schema";
import { formatUSD } from "@/lib/money";
import { isCloseOutState } from "@/lib/close-out/derive";
import { ChatToolError, defineTool, plural, type ChatToolContext } from "@/lib/chat/tools/define";
import { loadApprovalsReview, loadFiling, loadOutreachDrafts, loadPeriodClose } from "./approval-data";

export const reviewApprovalsTool = defineTool({
  name: "review_approvals",
  label: "Gathering what needs approval",
  description:
    "Shows every pending approval grouped by action, each with exactly what will happen (payload, amount, recipient, the irreversible " +
    "step that can follow). The PERSON approves on the card through the same server endpoint as the Approvals page. Read-only.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const p = await loadApprovalsReview(ctx);
    return {
      summary: `${plural(p.total, "approval")} waiting`,
      data: {
        asOf: p.asOf,
        waiting: p.total,
        toCompose: p.toCompose,
        readyToApprove: p.total - p.toCompose,
        groups: p.groups.map((g) => ({
          action: g.label,
          count: g.rows.length + g.more,
          rows: g.rows.map((r) => ({ title: r.title, amount: r.amountCents === null ? null : formatUSD(r.amountCents), state: r.state, unverified: r.unverified, approvableHere: r.approve !== null })),
        })),
      },
      ui: { kind: "approvals_review", props: p },
    };
  },
});

export const prepareOutreachTool = defineTool({
  name: "prepare_outreach",
  label: "Preparing outreach drafts",
  description:
    "Shows due-diligence letters already drafted (exact text from the rule file's wording, with an approval the PERSON gives) and items " +
    "that can be drafted, each with a Request approval button the person clicks. Read-only: nothing is drafted until they click.",
  input: z.object({ item: z.string().trim().min(1).max(80).optional().describe("check number (#10087) or payee name; omit for all draftable items") }),
  writes: false,
  async run(ctx, { item }) {
    const p = await loadOutreachDrafts(ctx, item ?? null);
    if (p.notFound) throw new ChatToolError(p.notFound);
    const toCompose = p.candidates.filter((c) => c.uncomposed).length;
    const draftable = p.candidates.filter((c) => c.decision === "draft" && !c.uncomposed).length;
    return {
      summary: `${plural(p.drafts.length, "letter")} ready to approve, ${plural(toCompose, "letter")} to compose, ${plural(draftable, "item")} can be drafted`,
      data: {
        asOf: p.asOf,
        toCompose,
        waitingLetters: p.drafts.map((d) => ({ check: d.checkNumber, owner: d.ownerName, amount: d.amountFormatted })),
        candidates: p.candidates.map((c) => ({ check: c.checkNumber, payee: c.payeeName, state: c.state, amount: formatUSD(c.amountCents), canDraft: c.decision === "draft" && !c.uncomposed, toCompose: c.uncomposed, reason: c.reason })),
      },
      ui: { kind: "outreach_drafts", props: p },
    };
  },
});

export const preparePeriodCloseTool = defineTool({
  name: "prepare_period_close",
  label: "Preparing the month-end close",
  description:
    "Shows a month's close: journal entry count, closing liability, the roll-forward tie-out by state (UNVERIFIED rule files flagged), " +
    "and an Approve close button the PERSON clicks (typed name bound to the journal hash). Read-only; closing is irreversible and human-only.",
  input: z.object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM"),
    month: z.string().trim().min(3).max(12).optional().describe("month name as typed, e.g. october"),
    year: z.number().int().min(2000).max(2100).optional(),
  }),
  writes: false,
  async run(ctx, input) {
    const p = await loadPeriodClose(ctx, input).catch((err: unknown) => {
      if (err instanceof Error && err.message === "unknown month") throw new ChatToolError("That is not a month I know. Try “Close October 2026”.");
      throw err;
    });
    return {
      summary: `${p.label}: ${p.status === "closed" ? "closed" : p.status === "open" ? "open" : "not started"}`,
      data: {
        period: p.label,
        status: p.status,
        asOf: p.asOf,
        entryCount: p.preview?.entryCount ?? null,
        closingLiability: p.preview ? formatUSD(p.preview.closingCents) : null,
        ties: p.tieOut?.allTie ?? null,
        closedBy: p.closed?.closedBy ?? null,
      },
      ui: { kind: "period_close", props: p },
    };
  },
});

async function defaultFilingState(ctx: ChatToolContext): Promise<string> {
  const [r] = await ctx.db
    .select({ state: reports.state })
    .from(reports)
    .where(and(eq(reports.companyId, ctx.companyId), inArray(reports.status, ["validated", "awaiting_approval", "approved"])))
    .orderBy(desc(reports.createdAt))
    .limit(1);
  return r?.state ?? "CA";
}

export const prepareFilingTool = defineTool({
  name: "prepare_filing",
  label: "Checking report readiness",
  description:
    "Shows whether a state's report is ready to file: items, validation, UNVERIFIED rule values, approval status. The PERSON approves the " +
    "report on the card (same endpoint and checksum as Reports); filing then runs only on the replica portal from the close-out runner.",
  input: z.object({ state: z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()).optional().describe("CA, DE or TX") }),
  writes: false,
  async run(ctx, { state }) {
    const st = state ?? (await defaultFilingState(ctx));
    if (!isCloseOutState(st)) throw new ChatToolError(`${st} is not covered yet (no rules loaded).`);
    const p = await loadFiling(ctx, st);
    return {
      summary: `${st} report: ${p.report?.status ?? "not generated"}`,
      data: {
        state: p.state,
        asOf: p.asOf,
        toReport: { count: p.toReport.count, amount: formatUSD(p.toReport.cents) },
        unverifiedRuleValues: p.unverifiedRules,
        report: p.report ? { status: p.report.status, items: p.report.itemCount, total: formatUSD(p.report.totalCents), errors: p.report.errorCount, approvableHere: p.report.approve !== null } : null,
      },
      ui: { kind: "filing", props: p },
    };
  },
});

/** Fixed order; appended to ASK_CARD_TOOLS after the slice 3 tools. */
export const ASK_APPROVAL_TOOLS = [reviewApprovalsTool, prepareOutreachTool, preparePeriodCloseTool, prepareFilingTool] as const;
