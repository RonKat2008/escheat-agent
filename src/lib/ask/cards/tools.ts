/**
 * Server tools behind the Ask action cards (docs/ASK-MODE.md slice 3). Same shape as the chat tools
 * (src/lib/chat/tools/define.ts): `data` is what a model would read, `ui` goes only to the client.
 *
 * Today they are run by the deterministic card intents (./intent.ts) with no model. They are NOT in CHAT_TOOLS, so the
 * model's tool list (and every recorded cassette key) is unchanged. Slice 2, when a key exists to re-record, exposes
 * them by appending `ASK_CARD_TOOLS` to CHAT_TOOLS.
 *
 * Invariants (tested): every tool is `writes: false`; no name starts with approve_/send_/file_/submit_/pay_/
 * close_period_/adopt_; `data` never carries ids, hashes, companyId or env values.
 */
import { z } from "zod";
import { loadQueue } from "@/app/(app)/approvals/queue-data";
import { formatUSD } from "@/lib/money";
import { OBLIGATION_LABEL } from "@/lib/overdue";
import { getOverdue } from "@/lib/queries/overdue";
import { today } from "@/lib/queries/common";
import { INGEST_KINDS } from "@/lib/ingest/schemas";
import { defineTool, plural, type ChatTool, type ChatToolContext } from "@/lib/chat/tools/define";
import { runTool, type ToolExecution } from "@/lib/chat/tools/run";
import type { NeedsYouApproval, NeedsYouOverdue } from "@/lib/chat/ui-types";
import { gettingStartedSteps, integrationRows, loadOnboardingCounts } from "./data";

/** Rows shown on the "what needs you" card; the counts always cover everything. */
export const NEEDS_YOU_ROWS = 8;

export const startImportTool = defineTool({
  name: "start_import",
  label: "Opening the CSV importer",
  description:
    "Shows an upload card where the PERSON picks a check-register or bank-clears CSV, maps its columns, previews row errors and " +
    "confirms the import. You never see the file. Use for 'upload a CSV', 'import bank clears'.",
  input: z.object({ kind: z.enum(INGEST_KINDS).default("ledger").describe("ledger (check register) or clears (bank clears)") }),
  writes: false,
  async run(ctx, { kind }) {
    const [counts, asOf] = await Promise.all([loadOnboardingCounts(ctx.db, ctx.companyId), today(ctx.db, ctx.companyId)]);
    const what = kind === "ledger" ? "check register" : "bank clears";
    return {
      summary: `upload card for a ${what} CSV`,
      data: { kind, ledgerRowsLoaded: counts.ledgerRows, note: "The person uploads and confirms on the card. Nothing is imported until they click Import." },
      ui: { kind: "import_card", props: { companyId: ctx.companyId, fileKind: kind, ledgerRows: counts.ledgerRows, asOf } },
    };
  },
});

export const getIntegrationsTool = defineTool({
  name: "get_integrations",
  label: "Checking integrations",
  description:
    "Lists each optional integration (AI, Lob test letters, email, voice, QuickBooks sandbox, Plaid sandbox, Inngest, Neon, Browserbase) " +
    "as configured or not, with the env var NAMES that turn it on. Never a value. Use for 'set up integrations', 'connect QuickBooks'.",
  input: z.object({}),
  writes: false,
  async run() {
    const rows = integrationRows(process.env);
    const configured = rows.filter((r) => r.state === "configured").length;
    return {
      summary: `${configured} of ${rows.length} integrations configured`,
      data: { integrations: rows.map((r) => ({ name: r.label, state: r.state, missingEnvNames: r.missing })) },
      ui: { kind: "integrations_card", props: { rows } },
    };
  },
});

export const listOverdueTool = defineTool({
  name: "list_overdue",
  label: "Finding what needs you",
  description:
    "Lists what is waiting on a PERSON: items past a deadline (dates from the rules engine; unknown dates are UNKNOWN, never guessed) " +
    "and drafts or reports waiting for approval. Read-only. Use for 'what's overdue?', 'what needs me?'.",
  input: z.object({}),
  writes: false,
  async run(ctx: ChatToolContext) {
    const [o, q] = await Promise.all([getOverdue(ctx.db, ctx.companyId), loadQueue(ctx.db, ctx.companyId)]);
    const waiting = q.entries.filter((e) => e.actionable);
    const overdue: NeedsYouOverdue[] = o.items.slice(0, NEEDS_YOU_ROWS).map((i) => ({
      itemId: i.itemId,
      checkNumber: i.checkNumber,
      payeeName: i.payeeName,
      state: i.state,
      amountCents: i.amount.cents,
      obligation: OBLIGATION_LABEL[i.earliest.kind],
      date: i.earliest.date,
      daysLate: i.daysLate,
      verified: i.verified,
      href: `/items?item=${encodeURIComponent(i.itemId)}`,
    }));
    const approvals: NeedsYouApproval[] = waiting.slice(0, NEEDS_YOU_ROWS).map((e) => ({
      key: e.key,
      kind: e.kind,
      title: e.title,
      subtitle: e.subtitle,
      href: `/approvals?sel=${encodeURIComponent(e.key)}`,
    }));
    return {
      summary: `${plural(o.count, "overdue item")}, ${waiting.length} waiting for approval`,
      data: {
        asOf: o.asOf,
        overdue: { count: o.count, total: o.total.formatted, unknownDates: o.unknownCount },
        approvalsWaiting: waiting.length,
        items: overdue.map((i) => ({ check: i.checkNumber, payee: i.payeeName, state: i.state, amount: formatUSD(i.amountCents), missed: i.obligation, date: i.date, daysLate: i.daysLate, verified: i.verified })),
      },
      ui: {
        kind: "overdue",
        props: { asOf: o.asOf, overdue, overdueCount: o.count, overdueCents: o.total.cents, unknownCount: o.unknownCount, approvals, approvalsCount: waiting.length },
      },
    };
  },
});

export const getStartedTool = defineTool({
  name: "get_started",
  label: "Checking your setup",
  description:
    "Shows the onboarding checklist from real state: ledger loaded, rules reviewed (UNVERIFIED count), first letter approved, first " +
    "report filed. Each step links to where the person does it. Use for 'get started', 'help'.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const steps = gettingStartedSteps(await loadOnboardingCounts(ctx.db, ctx.companyId));
    const doneCount = steps.filter((s) => s.done).length;
    return {
      summary: `${doneCount} of ${steps.length} setup steps done`,
      data: { steps: steps.map((s) => ({ step: s.title, done: s.done, detail: s.detail })) },
      ui: { kind: "getting_started", props: { steps, doneCount, total: steps.length } },
    };
  },
});

/** Fixed order. Slice 2 appends these to CHAT_TOOLS, in this order, when the cassettes can be re-recorded. */
export const ASK_CARD_TOOLS: readonly ChatTool[] = [getStartedTool, startImportTool, listOverdueTool, getIntegrationsTool] as ChatTool[];

const BY_NAME = new Map(ASK_CARD_TOOLS.map((t) => [t.name, t]));

export const getAskCardTool = (name: string): ChatTool | undefined => BY_NAME.get(name);

/** Validates the input with the tool's zod schema, then runs it. Never throws. */
export function executeAskCardTool(name: string, rawInput: unknown, ctx: ChatToolContext): Promise<ToolExecution> {
  return runTool(BY_NAME.get(name), name, rawInput, ctx);
}
