import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { agentRuns, companies, outreach } from "@/db/schema";
import { propertyTypeSchema } from "@/lib/agents/types";
import { allowedPhones, allowedRecipients } from "@/lib/env";
import { callStructured } from "@/lib/llm/client";
import { approveOutreach, sendOutreach } from "@/lib/outreach/send";
import { assertAllowedPhone, assertLobTestKey } from "@/lib/outreach/allowlist";
import { seedItem } from "@/lib/outreach/testing";
import { getAgentMailInbox } from "@/lib/outreach/agentmail";
import { fetchVapiAssistant, fetchVapiPhoneNumber, transferToolProblems } from "@/lib/outreach/voice";
import { DEFAULT_STAGEHAND_MODEL } from "@/lib/browser-agents/driver";
import { runRecoveryAgent } from "@/lib/browser-agents/recovery";
import { plaidConfig, qboConfig } from "@/lib/integrations/config";
import { createLinkToken, createSandboxPublicToken } from "@/lib/integrations/plaid/client";
import { createQboApi } from "@/lib/integrations/qbo/client";
import type { Connection, ConnectionStore } from "@/lib/integrations/store";
import {
  missingVars,
  notConfigured,
  SkipCheck,
  type ServiceCheck,
  type SmokeContext,
} from "./run";

/**
 * Per-service smoke checks. Each reuses the project's own integration modules; nothing here re-implements a client.
 *
 * Safety design (see scripts/smoke-live.ts header): outbound sends go through the REAL send paths
 * (approveOutreach -> sendOutreach -> withApproval -> allowlist / test-key guards). The approval is created
 * programmatically by approveOutreach with approver "smoke-live", for a synthetic row this script just inserted.
 */

export const SMOKE_APPROVER = "smoke-live";
/** Synthetic owner name present in the replica TX search data (see src/lib/replica/portal). */
export const REPLICA_FIXTURE_NAME = "Northwind Fixtures, Inc.";
const SYNTHETIC_NOTE = "SMOKE TEST. SYNTHETIC data. Not a real notice. Prototype, not legal advice.";

export type OutreachChannel = "letter" | "email" | "voice";

export interface SmokeDeps {
  callStructured: typeof callStructured;
  /** Creates a synthetic company/item and a draft outreach row; returns the outreach id. */
  seedOutreach: (db: Db, channel: OutreachChannel, fields: { subject?: string; body: string; toAddress?: string }) => Promise<string>;
  approveOutreach: typeof approveOutreach;
  sendOutreach: typeof sendOutreach;
  runRecovery: (opts: { companyId: string; states: string[]; baseUrl: string }) => Promise<{ runId: string }>;
  /** Seeds a synthetic company and returns its id (recovery agent input). */
  seedCompany: (db: Db) => Promise<string>;
  loadAgentRun: (db: Db, runId: string) => Promise<{ status: string; error: string | null; output: Record<string, unknown> | null } | undefined>;
  /** GET /inboxes/{id}: verifies the key and the configured inbox. */
  getInbox: (apiKey: string, inboxId: string) => Promise<{ inbox_id: string; email: string }>;
  /** GET /phone-number/{id}. */
  getPhoneNumber: (apiKey: string, phoneNumberId: string) => Promise<{ provider?: string; number?: string }>;
  /** GET /assistant/{id}; the raw config, for transferToolProblems. */
  getAssistant: (apiKey: string, assistantId: string) => Promise<unknown>;
  createLinkToken: typeof createLinkToken;
  createSandboxPublicToken: typeof createSandboxPublicToken;
  qboProbe: (a: { fetch: typeof fetch; refreshToken: string; realmId: string }) => Promise<{ purchaseCount: number | null; rotated: boolean }>;
}

const classifySchema = z.object({
  property_type: propertyTypeSchema,
  confidence: z.number(),
});

const SAFE_PROBE_TIMEOUT_MS = 3000;

async function probe(fetchImpl: typeof fetch, url: string): Promise<{ status: number; body: string } | undefined> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(SAFE_PROBE_TIMEOUT_MS) });
    return { status: res.status, body: await res.text().catch(() => "") };
  } catch {
    return undefined;
  }
}

const offlineReason = (ctx: SmokeContext): string | undefined =>
  ctx.env.ESCHEAT_OFFLINE ? "ESCHEAT_OFFLINE=1 replays cassettes / fakes sends; unset it for a live check" : undefined;

const money = (micros: number | null) => (micros === null ? "cost n/a" : `~$${(micros / 1_000_000).toFixed(5)}`);

/* ------------------------------------------------------------------ defaults */

const defaultDeps: SmokeDeps = {
  callStructured,
  async seedOutreach(db, channel, fields) {
    const { company, stale } = await seedItem(db, { ref: `SMOKE-${Date.now()}` });
    const [row] = await db
      .insert(outreach)
      .values({
        companyId: company.id,
        staleItemId: stale.id,
        channel,
        subject: fields.subject ?? null,
        body: fields.body,
        toAddress: fields.toAddress ?? null,
        tracking: { smoke: true },
      })
      .returning({ id: outreach.id });
    return row!.id;
  },
  approveOutreach,
  sendOutreach,
  async seedCompany(db) {
    const { company } = await seedItem(db, { ref: `SMOKE-${Date.now()}` });
    // seedItem's "(SYNTHETIC)" company name never matches the replica's records, so the search would return 0 rows
    // and the model would never be invoked. Use the replica's own synthetic fixture holder name instead.
    await db.update(companies).set({ name: REPLICA_FIXTURE_NAME }).where(eq(companies.id, company.id));
    return company.id;
  },
  runRecovery: (o) => runRecoveryAgent(o),
  async loadAgentRun(db, runId) {
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    return row && { status: row.status, error: row.error, output: row.output };
  },
  async getPhoneNumber(apiKey, phoneNumberId) {
    const n = await fetchVapiPhoneNumber(apiKey, phoneNumberId);
    return { provider: typeof n.provider === "string" ? n.provider : undefined, number: typeof n.number === "string" ? n.number : undefined };
  },
  getAssistant: fetchVapiAssistant,
  getInbox: (apiKey, inboxId) => getAgentMailInbox(apiKey, inboxId),
  createLinkToken,
  createSandboxPublicToken,
  async qboProbe({ fetch: fetchImpl, refreshToken, realmId }) {
    const cfg = qboConfig(process.env);
    if (!cfg) throw new Error("QuickBooks is not configured");
    let conn: Connection = {
      companyId: "smoke-live",
      provider: "qbo",
      realmId,
      accessToken: "smoke-expired-access-token", // forces the 401 -> refresh path through the real client
      refreshToken,
      expiresAt: null,
      cursor: null,
    };
    let rotated = false;
    const store: ConnectionStore = {
      get: async () => conn,
      save: async (c) => {
        rotated = c.refreshToken !== refreshToken;
        conn = c;
      },
    };
    const api = createQboApi({ cfg, store, companyId: "smoke-live", fetch: fetchImpl });
    const res = await api.query(
      "select count(*) from Purchase",
      z.object({ QueryResponse: z.object({ totalCount: z.number().optional() }).passthrough() }).passthrough(),
    );
    return { purchaseCount: res.QueryResponse.totalCount ?? null, rotated };
  },
};

/* -------------------------------------------------------------------- checks */

export function buildChecks(overrides: Partial<SmokeDeps> = {}): ServiceCheck[] {
  const d: SmokeDeps = { ...defaultDeps, ...overrides };
  return [
    anthropicCheck(d),
    stagehandCheck(d),
    lobCheck(d),
    agentMailCheck(d),
    vapiCheck(d),
    qboCheck(d),
    plaidCheck(d),
    inngestCheck(),
  ];
}

function anthropicCheck(d: SmokeDeps): ServiceCheck {
  return {
    service: "Anthropic",
    skipReason: (ctx) => notConfigured(missingVars(ctx.raw, ["ANTHROPIC_API_KEY"])) ?? offlineReason(ctx),
    async run() {
      const r = await d.callStructured({
        tier: "worker",
        agent: "smoke-live",
        toolName: "classify_item",
        system:
          "Classify one synthetic ledger line. property_type is one of vendor_check, payroll_check, customer_credit, unapplied_cash. confidence is 0 to 1.",
        messages: [
          { role: "user", content: "Check #SMOKE-1 for $120.00 payable to Acme Supplies (SYNTHETIC), memo: invoice 88 materials." },
        ],
        schema: classifySchema,
        maxTokens: 2048,
      });
      const u = r.usage;
      return `model=${r.model} tokens in=${u.inputTokens} out=${u.outputTokens} ${money(u.costUsdMicros)}; classified vendor_check? ${r.data.property_type === "vendor_check" ? "yes" : `no (${r.data.property_type})`}`;
    },
  };
}

/** A run that never called the model proves nothing about it; fail instead of passing silently. */
export function assertModelRan(output: Record<string, unknown> | null, runId: string, model: string): void {
  const modelCalls = Number(output?.modelCalls ?? 0);
  if (!Number.isFinite(modelCalls) || modelCalls < 1) {
    throw new Error(`run ${runId} made 0 model calls (model ${model}); the replica search returned no rows, so Stagehand was never exercised`);
  }
}

function stagehandCheck(d: SmokeDeps): ServiceCheck {
  return {
    service: "Stagehand",
    skipReason: (ctx) => notConfigured(missingVars(ctx.raw, ["ANTHROPIC_API_KEY"])) ?? offlineReason(ctx),
    async run(ctx) {
      const base = (ctx.raw.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
      const reachable = await probe(ctx.fetch, `${base}/replica/tx-search`);
      if (!reachable) throw new SkipCheck(`replica portal not reachable at ${base} (start \`pnpm dev\`, then re-run)`);
      if (reachable.status !== 200) throw new Error(`replica portal at ${base} answered HTTP ${reachable.status}`);
      const db = await ctx.getDb();
      const companyId = await d.seedCompany(db);
      // Stagehand mode is chosen by the agent runner itself when ANTHROPIC_API_KEY is set. Replica-only is enforced
      // by guardedGoto / the fenced browser; this check never passes a non-replica URL.
      const { runId } = await d.runRecovery({ companyId, states: ["TX"], baseUrl: base });
      const run = await d.loadAgentRun(db, runId);
      if (!run) throw new Error(`agent run ${runId} not found after the recovery agent returned`);
      const mode = String(run.output?.mode ?? "unknown");
      if (run.status !== "succeeded") throw new Error(`recovery agent run ${runId} ${run.status}: ${run.error ?? "no error recorded"}`);
      if (mode !== "stagehand") throw new Error(`recovery agent ran in "${mode}" mode, expected stagehand`);
      const created = Array.isArray(run.output?.created) ? run.output.created.length : 0;
      const alreadyKnown = Number(run.output?.alreadyKnown ?? 0);
      const model = ctx.raw.STAGEHAND_MODEL?.trim() || DEFAULT_STAGEHAND_MODEL;
      assertModelRan(run.output, runId, model);
      const modelCalls = Number(run.output?.modelCalls);
      return `run ${runId} mode=stagehand model=${model} modelCalls=${modelCalls} replica=${base} TX recoveries drafted=${created} alreadyTracked=${alreadyKnown}`;
    },
  };
}

function lobCheck(d: SmokeDeps): ServiceCheck {
  return {
    service: "Lob",
    skipReason: (ctx) => notConfigured(missingVars(ctx.raw, ["LOB_TEST_API_KEY"])) ?? offlineReason(ctx),
    async run(ctx) {
      // Refuse before any DB row or API call exists. sendLetter re-asserts the same guard.
      assertLobTestKey(ctx.env.LOB_TEST_API_KEY);
      const db = await ctx.getDb();
      const toAddress = JSON.stringify({
        name: "Bayline Electric (SYNTHETIC)",
        address_line1: "500 Market St",
        address_city: "San Francisco",
        address_state: "CA",
        address_zip: "94105",
      });
      const id = await d.seedOutreach(db, "letter", {
        subject: "Smoke test letter (SYNTHETIC)",
        body: `<html><body><p>${SYNTHETIC_NOTE}</p><p>Lob TEST-mode check from pnpm smoke:live.</p></body></html>`,
        toAddress,
      });
      await d.approveOutreach(db, id, SMOKE_APPROVER, { env: ctx.env });
      const res = await d.sendOutreach(db, id, { env: ctx.env, requestedBy: SMOKE_APPROVER });
      if (!res.sent || !res.providerId) throw new Error(`Lob did not accept the letter (status ${res.status}, offline=${res.offline})`);
      return `TEST-mode letter ${res.providerId} created${res.previewUrl ? `; preview ${res.previewUrl}` : ""}`;
    },
  };
}

function agentMailCheck(d: SmokeDeps): ServiceCheck {
  return {
    service: "AgentMail",
    skipReason: (ctx) =>
      notConfigured(missingVars(ctx.raw, ["AGENTMAIL_API_KEY", "AGENTMAIL_INBOX_ID", "ALLOWED_TEST_RECIPIENTS"])) ?? offlineReason(ctx),
    async run(ctx) {
      const to = allowedRecipients(ctx.env)[0];
      if (!to) throw new Error("ALLOWED_TEST_RECIPIENTS contains no usable address");
      // Read-only first: proves the key and that the configured inbox exists before anything is sent.
      const inbox = await d.getInbox(ctx.env.AGENTMAIL_API_KEY!, ctx.env.AGENTMAIL_INBOX_ID!);
      const db = await ctx.getDb();
      const id = await d.seedOutreach(db, "email", {
        subject: "Smoke test (SYNTHETIC) - Escheat Agent",
        body: `<p>${SYNTHETIC_NOTE}</p><p>AgentMail check from pnpm smoke:live.</p>`,
        toAddress: to,
      });
      await d.approveOutreach(db, id, SMOKE_APPROVER, { to, env: ctx.env });
      const res = await d.sendOutreach(db, id, { to, env: ctx.env, requestedBy: SMOKE_APPROVER });
      if (!res.sent || !res.providerId) throw new Error(`AgentMail did not accept the email (status ${res.status}, offline=${res.offline})`);
      return `inbox ${inbox.email} readable; email ${res.providerId} sent to ${to} (first ALLOWED_TEST_RECIPIENTS entry)`;
    },
  };
}

function vapiCheck(d: SmokeDeps): ServiceCheck {
  return {
    service: "Vapi",
    skipReason: (ctx) => notConfigured(missingVars(ctx.raw, ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID"])),
    async run(ctx) {
      const apiKey = ctx.env.VAPI_API_KEY!;
      const phoneNumberId = ctx.env.VAPI_PHONE_NUMBER_ID!;
      // Default: read-only GETs. No call is placed unless --dial is passed.
      const phone = await d.getPhoneNumber(apiKey, phoneNumberId);
      const last4 = phone.number?.replace(/\D/g, "").slice(-4);
      let base = `phone number ${last4 ? `ending ${last4}` : "(number n/a)"} (${phone.provider ?? "unknown provider"}) readable`;
      const assistantId = ctx.env.VAPI_ASSISTANT_ID;
      if (assistantId) {
        const problems = transferToolProblems(await d.getAssistant(apiKey, assistantId));
        if (problems.length > 0) throw new Error(`assistant ${assistantId} is unsafe for calls: ${problems.join("; ")}`);
        base += `; assistant ${assistantId} has no transfer tools`;
      }
      if (!ctx.args.dial) return `${base}; no call placed (pass --dial to place one simulated call)`;

      if (ctx.env.ESCHEAT_OFFLINE) throw new Error("--dial refused: ESCHEAT_OFFLINE=1 would not place a real call");
      const missing = missingVars(ctx.raw, ["ALLOWED_TEST_PHONES"]);
      if (missing.length > 0) throw new Error(`--dial needs ${missing.join(", ")}`);
      const target = ctx.args.dialTo ?? allowedPhones(ctx.env)[0];
      if (!target) throw new Error("ALLOWED_TEST_PHONES contains no usable number");
      const to = assertAllowedPhone(target, ctx.env); // explicit up-front refusal; placeCall re-checks
      // The smoke call always uses the inline assistant with a fixed SYNTHETIC script, never a saved assistant.
      const dialEnv = { ...ctx.env, VAPI_ASSISTANT_ID: undefined };
      const db = await ctx.getDb();
      const id = await d.seedOutreach(db, "voice", {
        body: `${SYNTHETIC_NOTE} This is a simulated test call from the Escheat Agent smoke check. Please say hello, then end the call.`,
        toAddress: to,
      });
      await d.approveOutreach(db, id, SMOKE_APPROVER, { to, env: dialEnv });
      const res = await d.sendOutreach(db, id, { to, env: dialEnv, requestedBy: SMOKE_APPROVER });
      if (!res.sent || !res.providerId) throw new Error(`call was not placed (status ${res.status}, offline=${res.offline})`);
      return `${base}; DIALED ${to} (allowlisted, inline assistant), call ${res.providerId}`;
    },
  };
}

function qboCheck(d: SmokeDeps): ServiceCheck {
  return {
    service: "QuickBooks",
    skipReason: (ctx) => {
      const missing = notConfigured(missingVars(ctx.raw, ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI"]));
      if (missing) return missing;
      const tokens = missingVars(ctx.raw, ["QBO_SMOKE_REFRESH_TOKEN", "QBO_SMOKE_REALM_ID"]);
      return tokens.length > 0
        ? `app credentials set, but QBO has no client-credentials flow: set ${tokens.join(" + ")} (sandbox OAuth Playground) to enable`
        : undefined;
    },
    async run(ctx) {
      const r = await d.qboProbe({ fetch: ctx.fetch, refreshToken: ctx.raw.QBO_SMOKE_REFRESH_TOKEN!, realmId: ctx.raw.QBO_SMOKE_REALM_ID! });
      return `sandbox token refresh + query OK (realm ${ctx.raw.QBO_SMOKE_REALM_ID}), Purchase count=${r.purchaseCount ?? "n/a"}${r.rotated ? "; refresh token ROTATED, update QBO_SMOKE_REFRESH_TOKEN before the next run" : ""}`;
    },
  };
}

function plaidCheck(d: SmokeDeps): ServiceCheck {
  const mask = (t: string) => `${t.slice(0, 12)}… (${t.length} chars)`;
  return {
    service: "Plaid",
    skipReason: (ctx) => notConfigured(missingVars(ctx.raw, ["PLAID_CLIENT_ID", "PLAID_SECRET"])),
    async run(ctx) {
      const cfg = plaidConfig(ctx.raw);
      if (!cfg) throw new Error(`PLAID_ENV="${ctx.raw.PLAID_ENV}" is not sandbox; refusing`);
      const link = await d.createLinkToken(cfg, "smoke-live", ctx.fetch);
      const pub = await d.createSandboxPublicToken(cfg, ctx.fetch);
      return `sandbox link_token ${mask(link)}; sandbox public_token ${mask(pub)} (First Platypus Bank)`;
    },
  };
}

function inngestCheck(): ServiceCheck {
  return {
    service: "Inngest",
    skipReason: () => undefined,
    async run(ctx) {
      const { INNGEST_EVENT_KEY: eventKey, INNGEST_SIGNING_KEY: signingKey } = ctx.env;
      const devUrl = (ctx.raw.INNGEST_BASE_URL?.trim() || "http://127.0.0.1:8288").replace(/\/+$/, "");
      const dev = await probe(ctx.fetch, devUrl);
      const appBase = (ctx.raw.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
      const app = await probe(ctx.fetch, `${appBase}/api/inngest`);
      const appNote = app && app.status === 200 ? `; app route ${appBase}/api/inngest reachable` : "; app route not reachable";

      if (Boolean(eventKey) !== Boolean(signingKey)) {
        throw new Error(`only ${eventKey ? "INNGEST_EVENT_KEY" : "INNGEST_SIGNING_KEY"} is set; Inngest Cloud needs both`);
      }
      if (eventKey && signingKey) {
        return `INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY present (presence only, no event sent)${dev ? `; dev server up at ${devUrl}` : ""}${appNote}`;
      }
      if (dev) return `dev server reachable at ${devUrl} (HTTP ${dev.status})${appNote}`;
      throw new SkipCheck(`not configured: no INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY and no dev server at ${devUrl} (\`npx inngest-cli@latest dev\`)`);
    },
  };
}
