import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";

/**
 * Unified audit timeline for one company, derived ONLY from real rows (no synthesized events).
 * Sources: approvals, outreach, reports, rule_changes, agent_runs, recoveries, ledger_items / bank_clears (ingestion).
 *
 * Scoping: every branch is anchored to `companyId`. Tables without a company column are reached through a company-owned
 * subject: approvals via stale_items / outreach / reports / recoveries / the company itself (approvals.subject_id) or via the
 * approval FKs; rule_changes only for states the company actually holds items or reports in. agent_runs with a NULL
 * company (system runs) are excluded.
 *
 * Caveat the UI repeats: the schema stores current status plus a few timestamps, not a status history. Report and
 * recovery status "changes" are therefore the timestamps that exist (generated, submitted, found), with the current status
 * shown in the detail. No intermediate transitions are invented.
 */

export const ACTIVITY_KINDS = ["approval", "outreach", "report", "rule", "run", "recovery", "ingestion"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  approval: "Approval",
  outreach: "Outreach",
  report: "Report",
  rule: "Rule change",
  run: "Agent run",
  recovery: "Recovery",
  ingestion: "Ingestion",
};

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 200;
const MAX_TEXT_LEN = 100;

export interface ActivityFilters {
  kinds?: readonly ActivityKind[];
  /** Two-letter state code. */
  state?: string;
  /** Inclusive UTC dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Free text, matched case-insensitively against title, detail, actor, state and approval hash prefix. */
  q?: string;
}

export interface ActivityQuery extends ActivityFilters {
  /** Opaque cursor from a previous page's `nextCursor`. Invalid cursors are ignored (first page). */
  cursor?: string | null;
  limit?: number;
}

export interface ActivityEntry {
  /** Stable unique id of the event (row id + event type). */
  id: string;
  at: Date;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  actor: string | null;
  state: string | null;
  /** In-app link to the subject. */
  href: string;
  /** First 12 hex chars of the approval payload SHA-256 (approval events only). */
  payloadHash: string | null;
  /** True for events that went wrong (failed run/report/outreach, rejected change); the UI marks these. */
  attention: boolean;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UID_RE = /^[\w:.-]{1,200}$/;

const isRealDate = (s: string) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

export function encodeCursor(atIso: string, uid: string): string {
  return Buffer.from(JSON.stringify([atIso, uid])).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { atIso: string; uid: string } | null {
  if (!cursor || cursor.length > 400) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [atIso, uid] = parsed as unknown[];
    if (typeof atIso !== "string" || typeof uid !== "string" || !ISO_RE.test(atIso) || !UID_RE.test(uid)) return null;
    return { atIso, uid };
  } catch {
    return null;
  }
}

/** Escape LIKE metacharacters (the query uses ESCAPE '\'). */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Parse raw URL params into validated filters. Unknown or malformed values are dropped, never thrown. */
export function parseActivityParams(p: Record<string, string | string[] | undefined>): ActivityQuery {
  const one = (k: string) => {
    const v = p[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const kindsRaw = (one("kind") ?? "").split(",").map((s) => s.trim());
  const kinds = ACTIVITY_KINDS.filter((k) => kindsRaw.includes(k));
  const state = one("state")?.toUpperCase();
  const from = one("from");
  const to = one("to");
  const q = one("q")?.slice(0, MAX_TEXT_LEN);
  const cursor = one("cursor");
  return {
    ...(kinds.length ? { kinds } : {}),
    ...(state && /^[A-Z]{2}$/.test(state) ? { state } : {}),
    ...(from && isRealDate(from) ? { from } : {}),
    ...(to && isRealDate(to) ? { to } : {}),
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

function eventsCte(companyId: string): SQL {
  const c = sql`${companyId}::uuid`;
  return sql`
    company_states AS (
      SELECT owner_state AS state FROM stale_items WHERE company_id = ${c} AND owner_state IS NOT NULL
      UNION SELECT state FROM reports WHERE company_id = ${c}
    ),
    subj AS (
      SELECT s.id::text AS sid, s.owner_state AS state, '/items?item=' || s.id::text AS href
        FROM stale_items s WHERE s.company_id = ${c}
      UNION ALL
      SELECT o.id::text, s.owner_state, '/items?item=' || s.id::text
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id WHERE o.company_id = ${c}
      UNION ALL
      SELECT r.id::text, r.state, '/reports?state=' || r.state FROM reports r WHERE r.company_id = ${c}
      UNION ALL
      SELECT rc.id::text, rc.state, '/recoveries' FROM recoveries rc WHERE rc.company_id = ${c}
      UNION ALL
      SELECT co.id::text, NULL::text, '/recoveries' FROM companies co WHERE co.id = ${c}
      UNION ALL
      SELECT g.id::text, g.state, '/rules?state=' || g.state FROM rule_changes g WHERE g.state IN (SELECT state FROM company_states)
    ),
    approval_fk AS (
      SELECT approval_id FROM outreach WHERE company_id = ${c} AND approval_id IS NOT NULL
      UNION SELECT approval_id FROM reports WHERE company_id = ${c} AND approval_id IS NOT NULL
      UNION SELECT approval_id FROM recoveries WHERE company_id = ${c} AND approval_id IS NOT NULL
    ),
    scoped_approvals AS (
      SELECT a.*, x.state AS subj_state, COALESCE(x.href, '/approvals') AS subj_href
        FROM approvals a LEFT JOIN subj x ON x.sid = a.subject_id
       WHERE x.sid IS NOT NULL OR a.id IN (SELECT approval_id FROM approval_fk)
    ),
    ev AS (
      SELECT 'approval:' || a.id::text || ':approved' AS uid, a.approved_at AS at, 'approval' AS kind,
             'Approved: ' || replace(a.action::text, '_', ' ') AS title,
             'Subject ' || a.subject_id AS detail, a.approved_by AS actor, a.subj_state AS state,
             a.subj_href AS href, left(a.payload_sha256, 12) AS payload_hash, false AS attention
        FROM scoped_approvals a WHERE a.approved_at IS NOT NULL
      UNION ALL
      SELECT 'approval:' || a.id::text || ':consumed', a.consumed_at, 'approval',
             'Approval used: ' || replace(a.action::text, '_', ' '),
             'Subject ' || a.subject_id, a.approved_by, a.subj_state, a.subj_href, left(a.payload_sha256, 12), false
        FROM scoped_approvals a WHERE a.consumed_at IS NOT NULL
      UNION ALL
      SELECT 'outreach:' || o.id::text || ':drafted', o.created_at, 'outreach',
             initcap(o.channel::text) || ' drafted', 'Current status: ' || o.status::text || CASE WHEN o.offline THEN ' (offline)' ELSE '' END,
             NULL::text, s.owner_state, '/items?item=' || s.id::text, NULL::text, (o.status = 'failed')
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id WHERE o.company_id = ${c}
      UNION ALL
      SELECT 'outreach:' || o.id::text || ':sent', o.sent_at, 'outreach',
             initcap(o.channel::text) || ' sent', 'Current status: ' || o.status::text || CASE WHEN o.offline THEN ' (offline)' ELSE '' END,
             NULL::text, s.owner_state, '/items?item=' || s.id::text, NULL::text, false
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id WHERE o.company_id = ${c} AND o.sent_at IS NOT NULL
      UNION ALL
      SELECT 'outreach:' || o.id::text || ':responded', o.responded_at, 'outreach',
             'Owner responded to ' || o.channel::text, NULL::text,
             NULL::text, s.owner_state, '/items?item=' || s.id::text, NULL::text, false
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id WHERE o.company_id = ${c} AND o.responded_at IS NOT NULL
      UNION ALL
      SELECT 'report:' || r.id::text || ':generated', r.created_at, 'report',
             'Report generated: ' || r.state || ' ' || r.report_year::text,
             'Current status: ' || r.status::text || ', ' || r.item_count::text || ' items', NULL::text, r.state,
             '/reports?state=' || r.state, NULL::text, (r.status = 'failed')
        FROM reports r WHERE r.company_id = ${c}
      UNION ALL
      SELECT 'report:' || r.id::text || ':submitted', r.submitted_at, 'report',
             'Report submitted: ' || r.state || ' ' || r.report_year::text,
             'Current status: ' || r.status::text, NULL::text, r.state, '/reports?state=' || r.state, NULL::text, false
        FROM reports r WHERE r.company_id = ${c} AND r.submitted_at IS NOT NULL
      UNION ALL
      SELECT 'rule:' || g.id::text || ':proposed', g.created_at, 'rule',
             'Rule change proposed: ' || g.state, COALESCE(g.from_version, 'none') || ' to ' || COALESCE(g.to_version, 'unknown'),
             NULL::text, g.state, '/rules?state=' || g.state, NULL::text, false
        FROM rule_changes g WHERE g.state IN (SELECT state FROM company_states)
      UNION ALL
      SELECT 'rule:' || g.id::text || ':reviewed', g.reviewed_at, 'rule',
             'Rule change ' || g.status::text || ': ' || g.state, COALESCE(g.from_version, 'none') || ' to ' || COALESCE(g.to_version, 'unknown'),
             g.reviewed_by, g.state, '/rules?state=' || g.state, NULL::text, (g.status = 'rejected')
        FROM rule_changes g WHERE g.reviewed_at IS NOT NULL AND g.state IN (SELECT state FROM company_states)
      UNION ALL
      SELECT 'run:' || ar.id::text || ':started', ar.started_at, 'run', 'Agent run started: ' || ar.agent,
             CASE WHEN ar.model IS NULL THEN NULL ELSE 'Model ' || ar.model END, NULL::text, s.owner_state,
             '/runs/' || ar.id::text, NULL::text, false
        FROM agent_runs ar LEFT JOIN stale_items s ON s.id = ar.stale_item_id WHERE ar.company_id = ${c}
      UNION ALL
      SELECT 'run:' || ar.id::text || ':finished', ar.finished_at, 'run', 'Agent run ' || ar.status::text || ': ' || ar.agent,
             CASE WHEN ar.error IS NULL THEN NULL ELSE left(ar.error, 200) END, NULL::text, s.owner_state,
             '/runs/' || ar.id::text, NULL::text, (ar.status = 'failed')
        FROM agent_runs ar LEFT JOIN stale_items s ON s.id = ar.stale_item_id WHERE ar.company_id = ${c} AND ar.finished_at IS NOT NULL
      UNION ALL
      SELECT 'recovery:' || rc.id::text || ':found', rc.found_at, 'recovery', 'Recovery found: ' || rc.state,
             'Current status: ' || rc.status::text || ', $' || to_char(rc.amount_cents / 100.0, 'FM999,999,999,990.00'),
             NULL::text, rc.state, '/recoveries', NULL::text, (rc.status = 'rejected')
        FROM recoveries rc WHERE rc.company_id = ${c}
      UNION ALL
      SELECT 'ingestion:ledger:' || l.source::text || ':' || extract(epoch FROM l.minute)::bigint::text, l.at, 'ingestion',
             'Ingested ' || l.n::text || ' ledger row' || CASE WHEN l.n = 1 THEN '' ELSE 's' END, 'Source: ' || l.source::text,
             NULL::text, NULL::text, '/items', NULL::text, false
        FROM (SELECT source, date_trunc('minute', created_at) AS minute, max(created_at) AS at, count(*) AS n
                FROM ledger_items WHERE company_id = ${c} GROUP BY source, date_trunc('minute', created_at)) l
      UNION ALL
      SELECT 'ingestion:bank:' || b.source::text || ':' || extract(epoch FROM b.minute)::bigint::text, b.at, 'ingestion',
             'Ingested ' || b.n::text || ' bank clear' || CASE WHEN b.n = 1 THEN '' ELSE 's' END, 'Source: ' || b.source::text,
             NULL::text, NULL::text, '/items', NULL::text, false
        FROM (SELECT source, date_trunc('minute', created_at) AS minute, max(created_at) AS at, count(*) AS n
                FROM bank_clears WHERE company_id = ${c} GROUP BY source, date_trunc('minute', created_at)) b
    )`;
}

interface Row {
  uid: string;
  at_iso: string;
  kind: string;
  title: string;
  detail: string | null;
  actor: string | null;
  state: string | null;
  href: string;
  payload_hash: string | null;
  attention: boolean;
}

function whereClause(f: ActivityQuery, cursor: { atIso: string; uid: string } | null): SQL {
  const conds: SQL[] = [sql`at IS NOT NULL`];
  if (f.kinds?.length) conds.push(sql`kind IN (${sql.join(f.kinds.map((k) => sql`${k}`), sql`, `)})`);
  if (f.state) conds.push(sql`state = ${f.state}`);
  if (f.from && isRealDate(f.from)) conds.push(sql`at >= ${f.from}::date::timestamptz`);
  if (f.to && isRealDate(f.to)) conds.push(sql`at < (${f.to}::date + 1)::timestamptz`);
  const q = f.q?.trim().slice(0, MAX_TEXT_LEN).toLowerCase();
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    conds.push(
      sql`lower(title || ' ' || COALESCE(detail, '') || ' ' || COALESCE(actor, '') || ' ' || COALESCE(state, '') || ' ' || COALESCE(payload_hash, '')) LIKE ${pat} ESCAPE '\\'`,
    );
  }
  if (cursor) conds.push(sql`(at, uid) < (${cursor.atIso}::timestamptz, ${cursor.uid}::text)`);
  return sql.join(conds, sql` AND `);
}

/**
 * One page of the company's activity, newest first (ties broken by event id, descending). Keyset pagination: pass the
 * previous page's `nextCursor`. `limit` is clamped to 1..MAX_ACTIVITY_LIMIT.
 */
export async function listActivity(db: Db, companyId: string, query: ActivityQuery = {}): Promise<ActivityPage> {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_ACTIVITY_LIMIT) || DEFAULT_ACTIVITY_LIMIT, 1), MAX_ACTIVITY_LIMIT);
  const cursor = decodeCursor(query.cursor);
  const statement = sql`
    WITH ${eventsCte(companyId)}
    SELECT uid, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_iso,
           kind, title, detail, actor, state, href, payload_hash, attention
      FROM ev
     WHERE ${whereClause(query, cursor)}
     ORDER BY at DESC, uid DESC
     LIMIT ${limit + 1}`;
  const res = (await db.execute(statement)) as unknown as { rows?: Row[] } | Row[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  const page = rows.slice(0, limit);
  const entries: ActivityEntry[] = page.map((r) => ({
    id: r.uid,
    at: new Date(r.at_iso),
    kind: r.kind as ActivityKind,
    title: r.title,
    detail: r.detail,
    actor: r.actor,
    state: r.state,
    href: r.href,
    payloadHash: r.payload_hash,
    attention: Boolean(r.attention),
  }));
  const last = page.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? encodeCursor(last.at_iso, last.uid) : null };
}
