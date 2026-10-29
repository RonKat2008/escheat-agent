import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { decryptToken, encryptToken } from "./token-crypto";

export type Provider = "qbo" | "plaid";

/** Decrypted view of a stored connection. */
export interface Connection {
  companyId: string;
  provider: Provider;
  /** QBO realm id; for Plaid the item_id */
  realmId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  /** Plaid /transactions/sync cursor */
  cursor: string | null;
}

/** Row shape with tokens already encrypted (mirrors integration_connections). */
export interface RawConnection {
  companyId: string;
  provider: Provider;
  realmId: string | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
  cursor: string | null;
}

export interface RawConnectionStore {
  get(companyId: string, provider: Provider): Promise<RawConnection | undefined>;
  upsert(row: RawConnection): Promise<void>;
}

export interface ConnectionStore {
  get(companyId: string, provider: Provider): Promise<Connection | undefined>;
  save(conn: Connection): Promise<void>;
}

/** Encrypts tokens on write and decrypts on read (AES-256-GCM). */
export function createConnectionStore(raw: RawConnectionStore, secret: string): ConnectionStore {
  const enc = (v: string | null) => (v === null ? null : encryptToken(v, secret));
  const dec = (v: string | null) => (v === null ? null : decryptToken(v, secret));
  return {
    async get(companyId, provider) {
      const r = await raw.get(companyId, provider);
      if (!r) return undefined;
      return {
        companyId: r.companyId,
        provider: r.provider,
        realmId: r.realmId,
        accessToken: dec(r.accessTokenEnc),
        refreshToken: dec(r.refreshTokenEnc),
        expiresAt: r.expiresAt,
        cursor: r.cursor,
      };
    },
    async save(c) {
      await raw.upsert({
        companyId: c.companyId,
        provider: c.provider,
        realmId: c.realmId,
        accessTokenEnc: enc(c.accessToken),
        refreshTokenEnc: enc(c.refreshToken),
        expiresAt: c.expiresAt,
        cursor: c.cursor,
      });
    },
  };
}

export function drizzleRawStore(db: Db): RawConnectionStore {
  const where = (companyId: string, provider: Provider) =>
    and(eq(integrationConnections.companyId, companyId), eq(integrationConnections.provider, provider));
  return {
    async get(companyId, provider) {
      const [r] = await db.select().from(integrationConnections).where(where(companyId, provider)).limit(1);
      if (!r) return undefined;
      return {
        companyId: r.companyId,
        provider: r.provider,
        realmId: r.realmId,
        accessTokenEnc: r.accessTokenEnc,
        refreshTokenEnc: r.refreshTokenEnc,
        expiresAt: r.expiresAt,
        cursor: r.cursor,
      };
    },
    async upsert(row) {
      const { companyId, provider, ...rest } = row;
      const existing = await this.get(companyId, provider);
      if (existing) await db.update(integrationConnections).set(rest).where(where(companyId, provider));
      else await db.insert(integrationConnections).values({ companyId, provider, ...rest });
    },
  };
}

export function memoryRawStore(): RawConnectionStore & { rows: Map<string, RawConnection> } {
  const rows = new Map<string, RawConnection>();
  const key = (c: string, p: Provider) => `${c}:${p}`;
  return {
    rows,
    async get(c, p) {
      return rows.get(key(c, p));
    },
    async upsert(row) {
      rows.set(key(row.companyId, row.provider), { ...row });
    },
  };
}
