import { NotConfiguredError, PLAID_NOT_CONFIGURED, QBO_NOT_CONFIGURED } from "./errors";
import { tokenSecretFromEnv } from "./token-crypto";

type EnvLike = Record<string, string | undefined>;
const val = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** always sandbox in this prototype */
  apiBase: string;
}

export const QBO_SANDBOX_API = "https://sandbox-quickbooks.api.intuit.com";
export const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export function qboConfig(env: EnvLike = process.env): QboConfig | undefined {
  const clientId = val(env.QBO_CLIENT_ID);
  const clientSecret = val(env.QBO_CLIENT_SECRET);
  const redirectUri = val(env.QBO_REDIRECT_URI);
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return { clientId, clientSecret, redirectUri, apiBase: QBO_SANDBOX_API };
}

export function requireQbo(env: EnvLike = process.env): QboConfig {
  const c = qboConfig(env);
  if (!c) throw new NotConfiguredError("qbo", QBO_NOT_CONFIGURED);
  return c;
}

export interface PlaidConfig {
  clientId: string;
  secret: string;
  apiBase: string;
}

export const PLAID_SANDBOX_API = "https://sandbox.plaid.com";

/** Sandbox only: PLAID_ENV other than 'sandbox' is treated as not configured. */
export function plaidConfig(env: EnvLike = process.env): PlaidConfig | undefined {
  const clientId = val(env.PLAID_CLIENT_ID);
  const secret = val(env.PLAID_SECRET);
  const plaidEnv = val(env.PLAID_ENV) ?? "sandbox";
  if (!clientId || !secret || plaidEnv !== "sandbox") return undefined;
  return { clientId, secret, apiBase: PLAID_SANDBOX_API };
}

export function requirePlaid(env: EnvLike = process.env): PlaidConfig {
  const c = plaidConfig(env);
  if (!c) throw new NotConfiguredError("plaid", PLAID_NOT_CONFIGURED);
  return c;
}

export function requireTokenSecret(provider: "qbo" | "plaid", env: EnvLike = process.env): string {
  const s = tokenSecretFromEnv(env);
  if (!s) {
    throw new NotConfiguredError(provider, "Token encryption secret not configured (set QBO_TOKEN_SECRET or OWNER_LINK_SECRET)");
  }
  return s;
}
