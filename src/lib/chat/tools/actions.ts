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

/** Lob address fields in the order they print on the envelope. */
const ADDRESS_FIELDS = ["name", "company", "address_line1", "address_line2", "address_city", "address_state", "address_zip", "address_country"] as const;
/** Longest body the card shows in full. A longer draft is never approvable inline (people approve exactly what they see). */
export const APPROVAL_CARD_MAX_BODY_CHARS = 12_000;
/** Letter markup whose content the plain-text preview cannot show (images, embeds, scripts). */
const UNSHOWABLE_MARKUP = /<(script|iframe|img|object|embed|svg|video|audio|link)\b/i;

/**
 * Every line of the recipient exactly as stored (letters keep the Lob address object as JSON). `complete` is false
 * when some stored field cannot be shown (unknown keys, non-string values, unparsable JSON), so the card can refuse
 * an inline approval of content it did not display.
 */
export function addressLines(raw: string | null): { lines: string[]; complete: boolean } {
  if (!raw) return { lines: [], complete: true };
  if (!raw.trimStart().startsWith("{")) return { lines: raw.split(/\r?\n/).filter((l) => l.trim()), complete: true };
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { lines: [raw], complete: false };
  }
  if (!a || typeof a !== "object" || Array.isArray(a)) return { lines: [raw], complete: false };
  const known = new Set<string>(ADDRESS_FIELDS);
  let complete = true;
  for (const [k, v] of Object.entries(a)) {
    if (v === null || v === undefined || v === "") continue;
    if (!known.has(k) || typeof v !== "string") complete = false;
  }
  const part = (k: (typeof ADDRESS_FIELDS)[number]) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string) : null);
  const cityLine = [part("address_city"), [part("address_state"), part("address_zip")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lines = [part("name"), part("company"), part("address_line1"), part("address_line2"), cityLine || null, part("address_country")].filter(
    (l): l is string => Boolean(l),
  );
  return { lines, complete };
}

/** Exported for tests. */
export async function approvalCard(ctx: ChatToolContext, outreachId: string, created: boolean): Promise<ApprovalCardUi["props"]> {
  const row = await loadOutreach(ctx.db, outreachId);
  const e = await explainItem(ctx.db, row.staleItemId);
  if (!e) throw new ChatToolError("The item for this draft no longer exists.");
  const compose = (row.tracking?.compose ?? {}) as {
    readiness?: { ready?: boolean; problems?: string[]; warnings?: string[] };
    requiredLanguageVerified?: boolean;
  };
  const r = compose.readiness ?? {};
  const fullBody = row.body ? (row.channel === "voice" ? row.body : htmlToText(row.body)) : null;
  const bodyTruncated = fullBody !== null && fullBody.length > APPROVAL_CARD_MAX_BODY_CHARS;
  const to = row.channel === "letter" ? addressLines(row.toAddress) : { lines: [], complete: true };
  // The approval hash covers id, channel, subject, body and (letters) the address: inline approval only when all of it is on the card.
  const fullyShown = !bodyTruncated && to.complete && !(row.channel === "letter" && row.body && UNSHOWABLE_MARKUP.test(row.body));
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
    bodyText: fullBody === null ? null : fullBody.slice(0, APPROVAL_CARD_MAX_BODY_CHARS),
    bodyTruncated,
    toAddressLines: to.lines,
    fullyShown,
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

