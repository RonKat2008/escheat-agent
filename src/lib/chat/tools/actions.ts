/**
 * Tools that prepare work for a human: outreach drafts and agent runs. None of them approves, sends, mails,
 * emails, calls or files anything. Approval stays a human click in the app (HARD RULE 5).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { outreach, staleItems } from "@/db/schema";
import { launchRecoveryAgent, RECOVERY_STATES } from "@/lib/browser-agents/recovery";
import { draftOutreach } from "@/lib/outreach/draft";
import { OutreachStateError } from "@/lib/outreach/errors";
import { htmlToText, loadOutreach, outreachContentSha256 } from "@/lib/outreach/util";
import { CLOSED_STATUSES, explainItem, findStaleItemId, getAgentRun, listAgentRuns } from "@/lib/queries";
import type { ApprovalCardUi } from "../ui-types";
import { ChatToolError, defineTool, ITEM_REF, normalizeItemRef, type ChatToolContext } from "./define";

const CHANNEL_NOUN = { letter: "due-diligence letter", email: "due-diligence email", voice: "check-in call script" } as const;

/** Letters store the Lob address object as JSON; show it as one readable line. Other channels pass through. */
function displayAddress(raw: string | null): string | null {
  if (!raw || !raw.trimStart().startsWith("{")) return raw;
  try {
    const a = JSON.parse(raw) as Record<string, unknown>;
    const part = (k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : null);
    const cityLine = [part("address_city"), [part("address_state"), part("address_zip")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [part("address_line1"), part("address_line2"), cityLine].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

async function approvalCard(ctx: ChatToolContext, outreachId: string, created: boolean): Promise<ApprovalCardUi["props"]> {
  const row = await loadOutreach(ctx.db, outreachId);
  const e = await explainItem(ctx.db, row.staleItemId);
  if (!e) throw new ChatToolError("The item for this draft no longer exists.");
  const compose = (row.tracking?.compose ?? {}) as {
    readiness?: { ready?: boolean; problems?: string[]; warnings?: string[] };
    requiredLanguageVerified?: boolean;
  };
  const r = compose.readiness ?? {};
  return {
    outreachId: row.id,
    channel: row.channel,
    status: row.status,
    created,
    itemId: row.staleItemId,
    checkNumber: e.item.checkNumber,
    ownerName: e.payee?.canonicalName ?? e.item.payeeName,
    ownerAddress: e.payee?.address || e.ledger.address,
    amountFormatted: e.item.amount.formatted,
    subject: row.subject,
    bodyText: row.body ? (row.channel === "voice" ? row.body : htmlToText(row.body)).slice(0, 4_000) : null,
    toAddress: displayAddress(row.toAddress),
    readiness: { ready: r.ready !== false, problems: r.problems ?? [], warnings: r.warnings ?? [] },
    requiredLanguageVerified: typeof compose.requiredLanguageVerified === "boolean" ? compose.requiredLanguageVerified : null,
    contentSha256: outreachContentSha256(row),
    previewUrl: `/api/outreach/${row.id}/preview`,
    reviewUrl: `/approvals?sel=${encodeURIComponent(`o:${row.id}`)}`,
  };
}

export const createOutreachDraftTool = defineTool({
  name: "create_outreach_draft",
  label: "Preparing a draft for approval",
  description:
    "WRITE ACTION, draft only. Composes (or returns the existing) due-diligence outreach DRAFT for one stale item: a letter (default), " +
    "an email, or a call script. It NEVER sends, mails, emails or calls anyone and CANNOT approve: the draft lands in /approvals and the " +
    "user sees an approval card to review. Letter wording comes from the state rule file, not from you.",
  input: z.object({
    item: ITEM_REF,
    channel: z.enum(["letter", "email", "voice"]).optional().describe("letter (default), email or voice (call script)"),
  }),
  writes: true,
  async run(ctx, { item, channel = "letter" }) {
    const id = await findStaleItemId(ctx.db, ctx.companyId, normalizeItemRef(item));
    if (!id) throw new ChatToolError(`No stale item found for "${item}".`);
    const [si] = await ctx.db.select({ status: staleItems.status }).from(staleItems).where(eq(staleItems.id, id));
    if (si && (CLOSED_STATUSES as readonly string[]).includes(si.status)) {
      throw new ChatToolError(`That item is ${si.status}; no outreach is needed.`);
    }
    const existing = await ctx.db
      .select({ id: outreach.id, status: outreach.status })
      .from(outreach)
      .where(and(eq(outreach.staleItemId, id), eq(outreach.channel, channel)));
    // Re-drafting an approved draft would void the human's approval; show it instead of touching it.
    const approved = existing.find((o) => o.status === "approved");
    let outreachId: string;
    let created = false;
    if (approved) {
      outreachId = approved.id;
    } else {
      try {
        const r = await draftOutreach(ctx.db, id, channel);
        outreachId = r.outreachId;
        created = !existing.some((o) => o.id === r.outreachId);
      } catch (err) {
        if (err instanceof OutreachStateError) throw new ChatToolError(err.message);
        throw err;
      }
    }
    const card = await approvalCard(ctx, outreachId, created);
    return {
      summary: `${CHANNEL_NOUN[channel]} ${card.status === "approved" ? "already approved by a human" : "drafted, awaiting human approval"}`,
      data: {
        drafted: true,
        sent: false,
        approvedByTool: false,
        channel,
        status: card.status,
        created,
        owner: card.ownerName,
        amount: card.amountFormatted,
        subject: card.subject,
        ready: card.readiness.ready,
        problems: card.readiness.problems,
        requiredLanguageVerified: card.requiredLanguageVerified,
        nextStep: "A human must review and approve it in /approvals before anything can be sent.",
      },
      ui: { kind: "approval_card", props: card },
    };
  },
});

export const listAgentRunsTool = defineTool({
  name: "list_agent_runs",
  label: "Reading the agent run log",
  description:
    "Lists recent agent runs (classifier, letter drafting, filing agent, recovery agent, this chat) with status, model, tokens and cost.",
  input: z.object({
    agent: z.string().trim().max(60).optional().describe("Filter by agent name, e.g. recovery-agent, filing-agent, chat"),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  writes: false,
  async run(ctx, { agent, limit }) {
    const rows = await listAgentRuns(ctx.db, ctx.companyId, { limit: agent ? 200 : (limit ?? 10), agent });
    const runs = rows.slice(0, limit ?? 10).map((r) => ({
      id: r.id,
      agent: r.agent,
      model: r.model,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsdMicros: r.costUsdMicros,
      error: r.error,
    }));
    return {
      summary: `${runs.length} runs`,
      data: { runs: runs.map(({ id, agent: a, model, status, startedAt, error }) => ({ id, agent: a, model, status, startedAt, error })) },
      ui: { kind: "runs", props: { runs } },
    };
  },
});

export const getAgentRunTool = defineTool({
  name: "get_agent_run",
  label: "Opening the agent run",
  description: "Shows one agent run's status, phase and step trace (live while it runs). Takes the run id.",
  input: z.object({ run_id: z.string().uuid() }),
  writes: false,
  async run(ctx, { run_id }) {
    const run = await getAgentRun(ctx.db, run_id);
    if (!run) throw new ChatToolError(`No agent run ${run_id}.`);
    const output = (run.output ?? {}) as Record<string, unknown>;
    return {
      summary: `${run.agent} ${run.status}`,
      data: {
        agent: run.agent,
        status: run.status,
        phase: output.phase ?? null,
        error: run.error,
        steps: Array.isArray(run.trace) ? run.trace.length : 0,
      },
      ui: { kind: "agent_run", props: { runId: run.id, agent: run.agent, title: run.agent, live: run.status === "running" } },
    };
  },
});

export const startRecoverySearchTool = defineTool({
  name: "start_recovery_search",
  label: "Starting the recovery agent",
  description:
    "Starts the recovery agent, which searches the REPLICA state unclaimed-property portals (never real states) for money owed BACK to the " +
    "company and drafts claims. It files nothing: every claim waits for a human approval. Takes a minute; the user sees it live.",
  input: z.object({ states: z.array(z.enum(RECOVERY_STATES)).min(1).max(3).optional() }),
  writes: true,
  async run(ctx, { states }) {
    const prod = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
    if (prod && process.env.AGENTS_ENABLED !== "1") {
      throw new ChatToolError("Browser agents are disabled in this deployment (AGENTS_ENABLED is not set).");
    }
    const { runId } = await launchRecoveryAgent({ companyId: ctx.companyId, states });
    return {
      summary: "recovery agent started",
      data: { runId, started: true, states: states ?? [...RECOVERY_STATES], filesClaims: false },
      ui: { kind: "agent_run", props: { runId, agent: "recovery-agent", title: "Recovery search on replica portals", live: true } },
    };
  },
});

