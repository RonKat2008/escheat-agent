import { asc, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { ruleApprovals } from "../../db/schema";

/**
 * R4-02: human rule approvals live in the DB (rule_approvals), never in the checked-in rules/*.json. The rule loader is
 * synchronous and called from many places, so the rows are held in a small in-process cache that loadRules overlays on
 * the reviewed baseline files (./load.ts). The cache:
 *   - is loaded (awaited) the first time getDb() hands out a database, and refreshed in the background after TTL_MS;
 *   - is re-read (awaited) before every approval, so the version + sha gate always sees the DB;
 *   - lives on globalThis because Next dev bundles each route separately (same reason as the DB handle).
 * A missing table (DB not migrated yet) reads as "no approvals": values stay as checked in, i.e. unverified.
 */

export interface OverlayRow {
  state: string;
  kind: "verify" | "adopt";
  baseVersion: string;
  /** sha256 of the checked-in rules/<STATE>.json this approval was made against. It applies only to that baseline. */
  baseSha256: string;
  version: string;
  fieldPaths: string[];
  value: unknown;
  ownerText: string | null;
  sources: unknown[];
  note: string | null;
  approvedBy: string;
  /** ISO timestamp. */
  approvedAt: string;
}

const TTL_MS = 2_000;

interface OverlayCache {
  rows: readonly OverlayRow[];
  loaded: boolean;
  loadedAt: number;
  /** Bumped by every explicit write to the cache; a background refresh started before it is discarded. */
  gen: number;
  loading: Promise<void> | null;
  warned: boolean;
}

const g = globalThis as typeof globalThis & { __escheatRuleOverlay?: OverlayCache };
const cache = (): OverlayCache => (g.__escheatRuleOverlay ??= { rows: [], loaded: false, loadedAt: 0, gen: 0, loading: null, warned: false });

/** The approval rows the loader overlays right now (every state, in approval order). */
export function overlayRows(): readonly OverlayRow[] {
  return cache().rows;
}

/** Replace the cached rows (tests, and after a write this process made). */
export function setOverlayRows(rows: readonly OverlayRow[]): void {
  const c = cache();
  c.rows = [...rows];
  c.loaded = true;
  c.loadedAt = Date.now();
  c.gen++;
}

/** Every active (not withdrawn) rule approval in the DB, oldest first. Throws when the query fails. */
export async function fetchOverlayRows(db: Db): Promise<OverlayRow[]> {
  const rows = await db.select().from(ruleApprovals).where(isNull(ruleApprovals.withdrawnAt)).orderBy(asc(ruleApprovals.approvedAt), asc(ruleApprovals.createdAt));
  return rows.map((r) => ({
    state: r.state,
    kind: r.kind,
    baseVersion: r.baseVersion,
    baseSha256: r.baseSha256,
    version: r.version,
    fieldPaths: r.fieldPaths,
    value: r.value ?? null,
    ownerText: r.ownerText,
    sources: r.sources,
    note: r.note,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt.toISOString(),
  }));
}

/** True when the error says the rule_approvals table does not exist (DB not migrated yet). */
function isMissingTable(e: unknown): boolean {
  // Postgres undefined_table (42P01), possibly wrapped by drizzle's "Failed query" error as `cause`.
  for (let cur: unknown = e, depth = 0; cur && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const err = cur as { code?: unknown; message?: unknown };
    if (err.code === "42P01") return true;
    if (typeof err.message === "string" && /rule_approvals" does not exist/.test(err.message)) return true;
  }
  return false;
}

/**
 * Re-read the approvals from the DB into the cache. `background` refreshes are dropped if the cache was written while
 * they ran (so a slow read never undoes an approval this process just made).
 */
export async function refreshRuleOverlay(db: Db, opts: { background?: boolean } = {}): Promise<void> {
  const c = cache();
  const gen = c.gen;
  let rows: OverlayRow[];
  try {
    rows = await fetchOverlayRows(db);
  } catch (e) {
    if (!isMissingTable(e)) {
      if (!opts.background) throw e;
      console.error("[rules] could not read rule approvals", e);
      return;
    }
    if (!c.warned) console.warn("[rules] rule_approvals table missing (run pnpm db:migrate); rule files load without approvals");
    c.warned = true;
    rows = [];
  }
  if (opts.background && c.gen !== gen) return;
  setOverlayRows(rows);
}

/** Called by getDb(): load once (awaited), then refresh in the background when older than TTL_MS. Never throws. */
export async function primeRuleOverlay(db: Db): Promise<void> {
  const c = cache();
  if (c.loading) {
    if (!c.loaded) await c.loading;
    return;
  }
  if (c.loaded && Date.now() - c.loadedAt < TTL_MS) return;
  const first = !c.loaded;
  c.loading = refreshRuleOverlay(db, { background: !first })
    .catch((e) => {
      console.error("[rules] could not read rule approvals", e);
      if (first) setOverlayRows([]);
    })
    .finally(() => {
      c.loading = null;
    });
  if (first) await c.loading;
}
