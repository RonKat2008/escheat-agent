import { z } from "zod";
import { IntegrationError } from "../errors";
import { QBO_AUTH_URL, QBO_TOKEN_URL, type QboConfig } from "../config";
import type { Connection, ConnectionStore } from "../store";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export function authorizeUrl(cfg: QboConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${QBO_AUTH_URL}?${p.toString()}`;
}

async function tokenRequest(
  cfg: QboConfig,
  body: Record<string, string>,
  fetchImpl: FetchLike,
  now: Date,
): Promise<z.infer<typeof TokenResponseSchema> & { expiresAt: Date }> {
  const res = await fetchImpl(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new IntegrationError(`QuickBooks token endpoint returned ${res.status}`, res.status);
  const parsed = TokenResponseSchema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new IntegrationError("QuickBooks token response failed validation", res.status, parsed.error);
  return { ...parsed.data, expiresAt: new Date(now.getTime() + parsed.data.expires_in * 1000) };
}

/** Exchange the OAuth code for tokens and persist them (encrypted by the store). */
export async function exchangeCode(
  cfg: QboConfig,
  store: ConnectionStore,
  args: { companyId: string; code: string; realmId: string },
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<Connection> {
  const t = await tokenRequest(
    cfg,
    { grant_type: "authorization_code", code: args.code, redirect_uri: cfg.redirectUri },
    fetchImpl,
    now,
  );
  const conn: Connection = {
    companyId: args.companyId,
    provider: "qbo",
    realmId: args.realmId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expiresAt,
    cursor: null,
  };
  await store.save(conn);
  return conn;
}

export interface QboApi {
  /** Run a QBO query; refreshes the token and retries once on 401. */
  query<S extends z.ZodType>(sql: string, schema: S): Promise<z.infer<S>>;
}

export function createQboApi(deps: {
  cfg: QboConfig;
  store: ConnectionStore;
  companyId: string;
  fetch?: FetchLike;
  now?: () => Date;
}): QboApi {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  let conn: Connection | undefined;

  const load = async (): Promise<Connection> => {
    conn ??= await deps.store.get(deps.companyId, "qbo");
    if (!conn || !conn.realmId || !conn.accessToken) throw new IntegrationError("QuickBooks is not connected for this company", 409);
    return conn;
  };

  const refresh = async (c: Connection): Promise<Connection> => {
    if (!c.refreshToken) throw new IntegrationError("QuickBooks refresh token missing; reconnect", 401);
    const t = await tokenRequest(
      deps.cfg,
      { grant_type: "refresh_token", refresh_token: c.refreshToken },
      fetchImpl,
      now(),
    );
    // QBO rotates the refresh token on every refresh: always persist the newest one.
    const next: Connection = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expiresAt };
    await deps.store.save(next);
    conn = next;
    return next;
  };

  const call = (c: Connection, sql: string) =>
    fetchImpl(`${deps.cfg.apiBase}/v3/company/${encodeURIComponent(c.realmId!)}/query?query=${encodeURIComponent(sql)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${c.accessToken}`, Accept: "application/json" },
    });

  return {
    async query(sql, schema) {
      let c = await load();
      let res = await call(c, sql);
      if (res.status === 401) {
        c = await refresh(c);
        res = await call(c, sql);
      }
      if (!res.ok) throw new IntegrationError(`QuickBooks query failed with HTTP ${res.status}`, res.status);
      const json: unknown = await res.json().catch(() => undefined);
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const detail = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new IntegrationError(`QuickBooks response failed validation (${detail})`, res.status, parsed.error);
      }
      return parsed.data;
    },
  };
}
