/** Approvals queue, rules, reports and recoveries. Reuses the same loaders as the app pages and API routes. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { reports } from "@/db/schema";
import { loadQueue } from "@/app/(app)/approvals/queue-data";
import { formatUSD } from "@/lib/money";
import { listRecoveries } from "@/lib/recoveries/service";
import { generateStateReport, listReportSummaries, ReportServiceError } from "@/lib/reports/service";
import { listRuleStates, tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import type { PendingApproval, RuleStateSummary } from "../ui-types";
import { ChatToolError, defineTool, STATE, type ChatToolContext } from "./define";

/** Statuses a person has in hand. Regenerating would replace (delete) such a report, so chat never does it. */
const UNDER_REVIEW = ["awaiting_approval", "approved"] as const;

async function reportUnderReview(ctx: ChatToolContext, state: string) {
  const [row] = await ctx.db
    .select()
    .from(reports)
    .where(and(eq(reports.companyId, ctx.companyId), eq(reports.state, state), inArray(reports.status, [...UNDER_REVIEW])))
    .orderBy(desc(reports.createdAt))
    .limit(1);
  return row ?? null;
}

export const listPendingApprovalsTool = defineTool({
  name: "list_pending_approvals",
  label: "Opening the approvals queue",
  description:
    "Lists everything waiting on a HUMAN in /approvals: outreach drafts (letters, emails, calls), reports to submit, recovery claims, " +
    "rule changes. Read-only. You cannot approve anything; tell the user to review and approve in the app.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const q = await loadQueue(ctx.db, ctx.companyId);
    const entries: PendingApproval[] = q.entries
      .filter((e) => e.actionable)
      .map((e) => ({
        key: e.key,
        kind: e.kind,
        title: e.title,
        subtitle: e.subtitle,
        amountCents: e.amountCents,
        state: e.state,
        status: e.statusKey,
        href: `/approvals?sel=${encodeURIComponent(e.key)}`,
      }));
    return {
      summary: `${entries.length} waiting on a human`,
      data: {
        count: entries.length,
        entries: entries.map((e) => ({
          kind: e.kind,
          title: e.title,
          detail: e.subtitle,
          amount: e.amountCents === null ? null : formatUSD(e.amountCents),
          status: e.status,
        })),
      },
      ui: { kind: "approvals", props: { entries } },
    };
  },
});

function summarizeRules(state: string): RuleStateSummary | null {
  const loaded = tryLoadRules(state);
  if (!loaded) return null;
  const values = listRuleValues(loaded.file);
  return {
    state,
    version: loaded.file.version,
    total: values.length,
    verified: values.filter((v) => v.rv.verified).length,
    unknown: values.filter((v) => v.rv.value === null).length,
    unverifiedPaths: values
      .filter((v) => !v.rv.verified)
      .map((v) => ({ path: v.path, todo: v.rv.todo ?? null, hasValue: v.rv.value !== null })),
  };
}

export const listRulesTool = defineTool({
  name: "list_rules",
  label: "Checking rule verification",
  description:
    "Shows each state's pinned rule file version and how many rule values are human-VERIFIED vs UNVERIFIED, plus which values are " +
    "missing (UNKNOWN). Use for 'which rules are unverified?'. Verification happens only by a human at /rules.",
  input: z.object({ state: STATE.optional() }),
  writes: false,
  async run(_ctx, { state }) {
    const states = (state ? [state] : listRuleStates()).map(summarizeRules).filter((s): s is RuleStateSummary => s !== null);
    if (states.length === 0) throw new ChatToolError(state ? `No rule file for ${state}; only CA, DE and TX exist.` : "No rule files found.");
    return {
      summary: states.map((s) => `${s.state} ${s.verified}/${s.total} verified`).join(", "),
      data: {
        states: states.map((s) => ({
          state: s.state,
          version: s.version,
          verified: s.verified,
          unverified: s.total - s.verified,
          unknownValues: s.unknown,
          unverifiedPaths: s.unverifiedPaths.slice(0, 40).map((p) => (p.hasValue ? p.path : `${p.path} (UNKNOWN: ${p.todo ?? "no value"})`)),
        })),
      },
      ui: { kind: "rules", props: { states } },
    };
  },
});

export const listReportsTool = defineTool({
  name: "list_reports",
  label: "Reviewing state reports",
  description:
    "Per state (CA, DE, TX): items currently To Report and their total, the rule version and unverified count, and the latest generated " +
    "NAUPA report with its status. Use before generate_report.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const rows = await listReportSummaries(ctx.db, ctx.companyId);
    const states = rows.map((r) => ({
      state: r.state,
      ruleVersion: r.ruleVersion,
      ruleUnverifiedCount: r.ruleUnverifiedCount,
      toReportCount: r.toReportCount,
      toReportCents: r.toReportCents,
      latest: r.latest
        ? { id: r.latest.id, status: r.latest.status, itemCount: r.latest.itemCount, totalCents: r.latest.totalCents, createdAt: r.latest.createdAt.toISOString() }
        : null,
    }));
    return {
      summary: states.map((s) => `${s.state} ${s.toReportCount} to report`).join(", "),
      data: {
        states: states.map((s) => ({
          state: s.state,
          toReport: s.toReportCount,
          toReportTotal: formatUSD(s.toReportCents),
          ruleVersion: s.ruleVersion,
          unverifiedRuleValues: s.ruleUnverifiedCount,
          latestReport: s.latest ? { status: s.latest.status, items: s.latest.itemCount, total: formatUSD(s.latest.totalCents) } : null,
        })),
      },
      ui: { kind: "reports", props: { states } },
    };
  },
});

export const generateReportTool = defineTool({
  name: "generate_report",
  label: "Generating and validating the report",
  description:
    "Generates and validates the NAUPA II report file for one state's To Report items, with totals, validation errors and warnings. " +
    "If that state already has a report awaiting approval or approved, it changes nothing and shows that report instead. " +
    "Files NOTHING: submitting goes through the filing agent and a human approval in the app. Only CA, DE, TX. Fails if no items are To Report " +
    "(the demo clock may need to advance first).",
  input: z.object({ state: STATE }),
  writes: true,
  async run(ctx, { state }) {
    const held = await reportUnderReview(ctx, state);
    if (held) {
      const waiting = held.status === "awaiting_approval";
      const href = waiting ? `/approvals?sel=${encodeURIComponent(`r:${held.id}`)}` : `/reports?state=${held.state}`;
      const notice = waiting
        ? `A ${held.state} report is already awaiting a person's approval. Generating a new one would replace it, so nothing was regenerated.`
        : `A ${held.state} report has already been approved by a person. Generating a new one would replace it, so nothing was regenerated.`;
      return {
        summary: `${held.state} report already ${waiting ? "under review" : "approved"}; not regenerated`,
        data: {
          regenerated: false,
          reason: notice,
          existingReport: { state: held.state, status: held.status, items: held.itemCount, total: formatUSD(held.totalCents) },
          nextStep: waiting ? "The user reviews it in /approvals." : "The user files it from /reports.",
          filed: false,
        },
        ui: {
          kind: "report",
          props: {
            reportId: held.id,
            state: held.state,
            status: held.status,
            itemCount: held.itemCount,
            totalCents: held.totalCents,
            checksum: held.checksum,
            stage: held.stage,
            errors: [],
            warnings: [],
            excludedCount: 0,
            heldForReview: { notice, href, linkLabel: waiting ? "Review in Approvals" : "Open in Reports" },
          },
        },
      };
    }
    try {
      const r = await generateStateReport(ctx.db, ctx.companyId, state);
      const errors = r.errors.map((e) => ({ field: e.field, message: e.message, severity: e.severity }));
      return {
        summary: `${r.report.state} report ${r.report.status}: ${r.totals.itemCount} ${r.totals.itemCount === 1 ? "item" : "items"}, ${formatUSD(r.totals.totalCents)}`,
        data: {
          state: r.report.state,
          status: r.report.status,
          items: r.report.itemCount,
          total: formatUSD(r.report.totalCents),
          errorCount: errors.filter((e) => e.severity === "error").length,
          warningCount: errors.filter((e) => e.severity === "warning").length + r.warnings.length,
          errors: errors.slice(0, 15),
          warnings: r.warnings.slice(0, 15),
          excludedItems: r.excludedItemIds.length,
          filed: false,
        },
        ui: {
          kind: "report",
          props: {
            reportId: r.report.id,
            state: r.report.state,
            status: r.report.status,
            itemCount: r.report.itemCount,
            totalCents: r.report.totalCents,
            checksum: r.report.checksum,
            stage: r.report.stage,
            errors,
            warnings: r.warnings,
            excludedCount: r.excludedItemIds.length,
            heldForReview: null,
          },
        },
      };
    } catch (err) {
      if (err instanceof ReportServiceError) throw new ChatToolError(err.message);
      throw err;
    }
  },
});

export const listRecoveriesTool = defineTool({
  name: "list_recoveries",
  label: "Looking up money owed back",
  description:
    "Lists money owed BACK to the company that the recovery agent found on the REPLICA state search portals, with match confidence, " +
    "claim status and whether a human approved the claim.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const rows = await listRecoveries(ctx.db, ctx.companyId);
    const recoveries = rows.map((r) => ({
      id: r.id,
      state: r.state,
      amountCents: r.amountCents,
      holderNameFound: r.holderNameFound,
      matchedNameVariant: r.matchedNameVariant,
      matchConfidence: r.matchConfidence,
      status: r.status,
      approvedBy: r.approval?.approvedBy ?? null,
    }));
    return {
      summary: `${recoveries.length} recoveries found`,
      data: {
        count: recoveries.length,
        total: formatUSD(recoveries.reduce((s, r) => s + r.amountCents, 0)),
        recoveries: recoveries.map((r) => ({
          state: r.state,
          amount: formatUSD(r.amountCents),
          holderName: r.holderNameFound,
          confidence: r.matchConfidence,
          status: r.status,
          approved: r.approvedBy !== null,
        })),
      },
      ui: { kind: "recoveries", props: { recoveries } },
    };
  },
});
