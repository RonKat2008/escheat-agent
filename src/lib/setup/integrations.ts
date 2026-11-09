/** Optional integrations, keyed by the env var NAMES that turn each on. Status is by presence only; values are never read out. */

export interface Integration {
  id: string;
  label: string;
  /** All of these must be set for the integration to count as configured. */
  required: readonly string[];
  /** What the demo does without it. */
  fallback: string;
}

export const INTEGRATIONS: readonly Integration[] = [
  { id: "anthropic", label: "AI (chat, live classifier, Stagehand agents)", required: ["ANTHROPIC_API_KEY"], fallback: "labeled heuristic classifier and scripted browser agents; /ask replays recorded demo prompts only with ESCHEAT_OFFLINE=1" },
  { id: "lob", label: "Letters (Lob TEST mode)", required: ["LOB_TEST_API_KEY"], fallback: "send shows \"not configured\"; approval still works" },
  { id: "agentmail", label: "Email (AgentMail, allowlisted recipients)", required: ["AGENTMAIL_API_KEY", "AGENTMAIL_INBOX_ID", "ALLOWED_TEST_RECIPIENTS"], fallback: "email refused as \"not configured\"" },
  { id: "vapi", label: "Voice calls (Vapi, allowlisted numbers)", required: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "ALLOWED_TEST_PHONES"], fallback: "calls refused as \"not configured\"" },
  { id: "qbo", label: "QuickBooks Online sandbox", required: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI"], fallback: "CSV ingest only" },
  { id: "plaid", label: "Plaid sandbox", required: ["PLAID_CLIENT_ID", "PLAID_SECRET"], fallback: "CSV ingest only" },
  { id: "inngest", label: "Inngest cloud (durable workflows)", required: ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"], fallback: "not needed locally; `npx inngest-cli@latest dev` is optional" },
  { id: "neon", label: "Neon Postgres", required: ["DATABASE_URL"], fallback: "file-backed PGlite in .data/pglite" },
  { id: "browserbase", label: "Hosted browser (Browserbase)", required: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"], fallback: "local Playwright" },
];

export type IntegrationState = "configured" | "partial" | "not configured";

export interface IntegrationStatus extends Integration {
  state: IntegrationState;
  /** Names still unset (never values). */
  missing: string[];
}

export function integrationStatuses(env: Record<string, string>): IntegrationStatus[] {
  return INTEGRATIONS.map((i) => {
    const missing = i.required.filter((n) => !env[n]);
    const state: IntegrationState = missing.length === 0 ? "configured" : missing.length === i.required.length ? "not configured" : "partial";
    return { ...i, state, missing };
  });
}
