import { z } from "zod";
import type { Db } from "@/db/client";
import { IntegrationError } from "../errors";
import { requirePlaid, requireTokenSecret, type PlaidConfig } from "../config";
import { createConnectionStore, drizzleRawStore, type Connection, type ConnectionStore } from "../store";
import type { FetchLike } from "../qbo/client";

const PlaidErrorSchema = z.object({ error_code: z.string().optional(), error_message: z.string().optional() });

/** POST a Plaid endpoint, Zod-validate the response. */
export async function plaidPost<S extends z.ZodType>(
  cfg: PlaidConfig,
  path: string,
  body: Record<string, unknown>,
  schema: S,
  fetchImpl: FetchLike = fetch,
): Promise<z.infer<S>> {
  const res = await fetchImpl(`${cfg.apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, secret: cfg.secret, ...body }),
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const e = PlaidErrorSchema.safeParse(json);
    const detail = e.success && e.data.error_code ? `${e.data.error_code}: ${e.data.error_message ?? ""}` : `HTTP ${res.status}`;
    throw new IntegrationError(`Plaid ${path} failed (${detail.trim()})`, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new IntegrationError(`Plaid ${path} response failed validation (${detail})`, res.status, parsed.error);
  }
  return parsed.data;
}

const LinkTokenSchema = z.object({ link_token: z.string().min(1), expiration: z.string().optional() });

export async function createLinkToken(cfg: PlaidConfig, companyId: string, fetchImpl?: FetchLike): Promise<string> {
  const r = await plaidPost(
    cfg,
    "/link/token/create",
    {
      client_name: "Escheat Agent",
      user: { client_user_id: companyId },
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    },
    LinkTokenSchema,
    fetchImpl,
  );
  return r.link_token;
}

const PublicTokenSchema = z.object({ public_token: z.string().min(1) });

/** Sandbox shortcut (no Link UI): First Platypus Bank. */
export async function createSandboxPublicToken(cfg: PlaidConfig, fetchImpl?: FetchLike): Promise<string> {
  const r = await plaidPost(
    cfg,
    "/sandbox/public_token/create",
    { institution_id: "ins_109508", initial_products: ["transactions"] },
    PublicTokenSchema,
    fetchImpl,
  );
  return r.public_token;
}

const ExchangeSchema = z.object({ access_token: z.string().min(1), item_id: z.string().min(1) });

export async function exchangePublicToken(
  cfg: PlaidConfig,
  store: ConnectionStore,
  args: { companyId: string; publicToken: string },
  fetchImpl?: FetchLike,
): Promise<Connection> {
  const r = await plaidPost(cfg, "/item/public_token/exchange", { public_token: args.publicToken }, ExchangeSchema, fetchImpl);
  const conn: Connection = {
    companyId: args.companyId,
    provider: "plaid",
    realmId: r.item_id,
    accessToken: r.access_token,
    refreshToken: null,
    expiresAt: null,
    cursor: null,
  };
  await store.save(conn);
  return conn;
}

export function defaultPlaidDeps(db: Db) {
  return { cfg: requirePlaid(), store: createConnectionStore(drizzleRawStore(db), requireTokenSecret("plaid")) };
}
