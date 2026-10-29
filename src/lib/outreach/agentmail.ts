import { OutreachProviderError } from "./errors";

/** Plain-fetch AgentMail client (https://docs.agentmail.to, OpenAPI at /openapi.json). No SDK. */
export const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";
const AGENTMAIL_REQUEST_TIMEOUT_MS = 15_000;

/** The one inbox this app ever creates. Never send from, list-and-pick, or modify any other inbox. */
export const AGENTMAIL_INBOX_USERNAME = "escheat-agent";
export const AGENTMAIL_INBOX_DISPLAY_NAME = "Escheat Agent Prototype"; // AgentMail rejects "(" and ")" in display names
/** Idempotency key for POST /inboxes (client_id may not contain "@"). */
export const AGENTMAIL_INBOX_CLIENT_ID = "escheat-agent-prototype-inbox";

export interface AgentMailInbox {
  inbox_id: string;
  email: string;
  display_name?: string;
}

interface RequestOpts {
  apiKey: string;
  fetch?: typeof fetch;
}

/**
 * One AgentMail API call. Never retries. A rejected request carries its HTTP status (error bodies are
 * `{ name, code, message }`); network errors and timeouts carry none, so an unconfirmed send stays "unknown outcome".
 */
export async function agentmailRequest(
  req: RequestOpts,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = { method: "GET" },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await (req.fetch ?? fetch)(`${AGENTMAIL_BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(AGENTMAIL_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OutreachProviderError("agentmail", e instanceof Error ? e.message : String(e));
  }
  const text = await res.text().catch(() => "");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const m = (json as { message?: unknown; code?: unknown } | undefined)?.message;
    const code = (json as { code?: unknown } | undefined)?.code;
    const detail = typeof m === "string" ? m : text.slice(0, 200);
    throw new OutreachProviderError("agentmail", `${res.status} ${typeof code === "string" ? `[${code}] ` : ""}${detail || res.statusText}`.trim(), res.status);
  }
  if (!json || typeof json !== "object") throw new OutreachProviderError("agentmail", "response was not a JSON object");
  return json as Record<string, unknown>;
}

function asInbox(o: Record<string, unknown>): AgentMailInbox {
  if (typeof o.inbox_id !== "string" || typeof o.email !== "string") {
    throw new OutreachProviderError("agentmail", "inbox response had no inbox_id/email");
  }
  return { inbox_id: o.inbox_id, email: o.email, display_name: typeof o.display_name === "string" ? o.display_name : undefined };
}

/** GET /inboxes/{inbox_id}: proves the key works and the configured inbox exists (smoke check). */
export async function getAgentMailInbox(apiKey: string, inboxId: string, fetchImpl?: typeof fetch): Promise<AgentMailInbox> {
  return asInbox(await agentmailRequest({ apiKey, fetch: fetchImpl }, `/inboxes/${encodeURIComponent(inboxId)}`));
}

/**
 * Creates (or returns, via client_id idempotency) the dedicated `escheat-agent` inbox. Only called by the explicit
 * `pnpm agentmail:setup` step; send() never creates anything. Pre-existing inboxes are never listed, picked or touched.
 */
export async function createOrGetAgentMailInbox(apiKey: string, fetchImpl?: typeof fetch): Promise<AgentMailInbox> {
  return asInbox(
    await agentmailRequest({ apiKey, fetch: fetchImpl }, "/inboxes", {
      method: "POST",
      body: { username: AGENTMAIL_INBOX_USERNAME, display_name: AGENTMAIL_INBOX_DISPLAY_NAME, client_id: AGENTMAIL_INBOX_CLIENT_ID },
    }),
  );
}
