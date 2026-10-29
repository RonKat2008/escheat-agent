import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  explainItem,
  findStaleItemId,
  getAuditInterestExposure,
  getDefaultCompanyId,
  getExposure,
  listStaleItems,
  PropertyTypeSchema,
  StaleStatusSchema,
  upcomingDeadlines,
} from "@/lib/queries";
import { formatUSD } from "@/lib/money";
import { createOutreachDraft, DRAFT_ONLY_NOTICE } from "./drafts";
import { toolError, toolResult } from "./format";

const STATE = z.string().length(2).describe("Two-letter US state code of the OWNER's state, e.g. CA, TX, DE");

/** Wrap a handler so thrown errors become MCP tool errors instead of protocol failures. */
const safe =
  <A>(fn: (args: A) => Promise<ReturnType<typeof toolResult>>) =>
  async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return toolError(e instanceof Error ? e.message : String(e));
    }
  };

export function createEscheatMcpServer(db: Db): McpServer {
  const server = new McpServer({ name: "escheat-agent", version: "0.1.0" });
  const company = () => getDefaultCompanyId(db);

  server.registerTool(
    "get_exposure",
    {
      title: "Unclaimed property exposure",
      description:
        "Answers 'What do we owe in unclaimed property, and where?'. Returns the total dollars and item count of open stale items " +
        "(uncashed checks, credits, unapplied cash not yet resolved or remitted), broken down by the owner's state, by workflow status " +
        "and by property type, plus whether any figure depends on an UNVERIFIED state rule. Optionally restrict to one state. " +
        "Call this first for any high-level 'how much / where' question.",
      inputSchema: { state: STATE.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ state }: { state?: string }) => {
      const e = await getExposure(db, await company(), { state });
      const where = e.byState.map((s) => `${s.state} ${s.formatted} (${s.count})`).join(", ");
      return toolResult(
        `As of ${e.asOf}: ${e.itemCount} open items totaling ${e.total.formatted}${state ? ` in ${state.toUpperCase()}` : ""}. By state: ${where || "none"}.`,
        e,
        { unverified: e.anyUnverified },
      );
    }),
  );

  server.registerTool(
    "list_stale_items",
    {
      title: "List stale items",
      description:
        "Lists open stale/unclaimed items (one per uncashed check or credit) with payee, check number, amount, age in days, owner state and " +
        "basis (address vs incorporation), workflow status and the next deadline with its verified flag. Use for drill-downs such as " +
        "'which Texas items are oldest?' or 'anything over $5,000?'. Supports filters, sorting and paging. For one item's full history use explain_item.",
      inputSchema: {
        state: STATE.optional(),
        status: StaleStatusSchema.optional(),
        property_type: PropertyTypeSchema.optional(),
        min_age_days: z.number().int().nonnegative().optional().describe("Only items at least this many days old"),
        max_age_days: z.number().int().nonnegative().optional(),
        search: z.string().optional().describe("Matches payee name or check number"),
        needs_review: z.boolean().optional().describe("true = only items flagged for human review"),
        include_closed: z.boolean().optional().describe("Include resolved_paid and remitted items (default false)"),
        sort: z.enum(["age_desc", "age_asc", "amount_desc", "amount_asc", "payee_asc", "deadline_asc"]).optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 25"),
        offset: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (a: Record<string, unknown>) => {
      const r = await listStaleItems(db, await company(), {
        state: a.state as string | undefined,
        status: a.status as never,
        propertyType: a.property_type as never,
        minAgeDays: a.min_age_days as number | undefined,
        maxAgeDays: a.max_age_days as number | undefined,
        search: a.search as string | undefined,
        needsReview: a.needs_review as boolean | undefined,
        includeClosed: a.include_closed as boolean | undefined,
        sort: a.sort as never,
        limit: (a.limit as number | undefined) ?? 25,
        offset: a.offset as number | undefined,
      });
      return toolResult(
        `${r.total} matching items (showing ${r.items.length}, as of ${r.asOf}).`,
        r,
        { unverified: r.items.some((i) => i.dependsOnUnverified) },
      );
    }),
  );

  server.registerTool(
    "upcoming_deadlines",
    {
      title: "Upcoming deadlines",
      description:
        "Lists compliance deadlines (due-diligence window start/end, report due, remittance due) falling between today and N days ahead " +
        "(default 90), sorted by date, each with the item, owner state and whether the deadline rests on a verified rule. Use for 'what is due soon?'. " +
        "'Today' follows the app's demo clock.",
      inputSchema: { days: z.number().int().min(1).max(730).optional().describe("Look-ahead window in days; default 90") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ days }: { days?: number }) => {
      const d = await upcomingDeadlines(db, await company(), days ?? 90);
      return toolResult(`${d.events.length} deadline events from ${d.asOf} over the next ${d.days} days.`, d, {
        unverified: d.events.some((e) => !e.verified),
      });
    }),
  );

  server.registerTool(
    "explain_item",
    {
      title: "Explain an item",
      description:
        "Explains one stale item end to end: payee, ledger entry, every legal date (presumed abandoned, due-diligence window, report due, remit due) " +
        "with the rule path, rule version, official source URLs and quotes, and a verified flag per date, plus outreach history, approvals and agent runs. " +
        "Accepts a check number (e.g. '10482') or an item id. Use for 'why is this due on that date?'.",
      inputSchema: { id_or_check_number: z.string().min(1).describe("Check number such as 10482, or the stale item UUID") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ id_or_check_number }: { id_or_check_number: string }) => {
      const companyId = await company();
      const id = await findStaleItemId(db, companyId, id_or_check_number);
      const e = id ? await explainItem(db, id) : null;
      if (!e) return toolError(`No stale item found for "${id_or_check_number}". Try list_stale_items with a search term.`) as never;
      const anyUnverified = e.timeline.some((t) => t.status !== "ok" || !t.verified);
      return toolResult(
        `${e.item.payeeName}, check ${e.item.checkNumber ?? "n/a"}, ${e.item.amount.formatted}, ${e.item.ownerState ?? "unknown state"}, status ${e.item.status}, ${e.item.ageDays} days old.`,
        e,
        { unverified: anyUnverified },
      );
    }),
  );

  server.registerTool(
    "get_audit_interest_exposure",
    {
      title: "Audit interest exposure",
      description:
        "Estimates interest the company could owe per state if open items were reported late, computed deterministically from each state's interest rule. " +
        "Always an ESTIMATE; labeled 'Estimate; rule unverified' when the state rule is unverified, and null/unknown when a rule or due date is missing. " +
        "Use for 'what is our audit risk?'.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const r = await getAuditInterestExposure(db, await company());
      const tot = r.total ? formatUSD(r.total.cents) : "UNKNOWN";
      return toolResult(`${r.label}: estimated interest ${tot} as of ${r.asOf}.`, r, { unverified: r.anyUnverified });
    }),
  );

  server.registerTool(
    "create_outreach_draft",
    {
      title: "Create outreach draft (needs human approval)",
      description:
        "WRITE ACTION, draft only. Creates (or returns the existing) due-diligence letter DRAFT for a stale item so a human can review it. " +
        "It never sends, mails, emails or calls anyone and does not approve anything; the reviewer must approve it in the app at /approvals. " +
        "Idempotent: calling twice returns the same draft. Accepts a check number or item id.",
      inputSchema: { item_id: z.string().min(1).describe("Stale item UUID or check number such as 10482") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ item_id }: { item_id: string }) => {
      const d = await createOutreachDraft(db, await company(), item_id);
      return toolResult(`${DRAFT_ONLY_NOTICE}. ${d.created ? "Draft created" : "Existing draft returned"} (outreach ${d.outreachId}, status ${d.status}).`, d);
    }),
  );

  return server;
}
