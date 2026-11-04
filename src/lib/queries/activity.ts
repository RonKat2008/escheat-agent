import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ClockStep } from "@/lib/clock-history";

/**
 * Unified audit timeline for one company, derived ONLY from real rows (no synthesized events).
 * Sources: approvals, outreach, reports, rule_changes, agent_runs (one row per run), payees (human review trail), recoveries, ledger_items / bank_clears (ingestion),
 * demo_clock_events (each change of the demo date, with what the move detected and removed: R8-09 / R9-02).
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

export const ACTIVITY_KINDS = ["approval", "outreach", "report", "rule", "run", "recovery", "ingestion", "payee", "clock"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  approval: "Approval",
  outreach: "Outreach",
  report: "Report",
  rule: "Rule change",
  run: "Agent run",
  recovery: "Recovery",
  ingestion: "Ingestion",
  payee: "Payee",
  clock: "Demo clock",
};

export const DEFAULT_ACTIVITY_LIMIT = 50;
export const MAX_ACTIVITY_LIMIT = 200;
const MAX_TEXT_LEN = 100;

export interface ActivityFilters {
  kinds?: readonly ActivityKind[];
  /** Two-letter state code. */
  state?: string;
  /** Inclusive DEMO dates (see `clock`), YYYY-MM-DD. Without `clock` the demo day is the UTC day of the timestamp. */
  from?: string;
  to?: string;
  /** Free text, matched case-insensitively against title, detail, actor, state and approval hash prefix. */
  q?: string;
  /** The company's clock log. Activity is a demo-calendar view: an entry belongs to the demo day the clock showed when it was recorded. */
  clock?: ActivityClock;
}

export interface ActivityClock {
  history: readonly ClockStep[];
  /** Today's demo date: events from before the first clock log are clamped to it (legacy rule). */
  today: string;
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
  /** The demo date (YYYY-MM-DD) the clock showed when this was recorded. The time of day stays the real UTC time. */
  demoDay: string;
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
      SELECT s.id::text AS sid, s.owner_state AS state, '/items?item=' || s.id::text AS href,
             l.payee_name_raw || COALESCE(' · check #' || l.reference_number, '') || ' · $' || to_char(s.amount_cents / 100.0, 'FM999,999,999,990.00') AS label
        FROM stale_items s JOIN ledger_items l ON l.id = s.ledger_item_id WHERE s.company_id = ${c}
      UNION ALL
      SELECT o.id::text, s.owner_state, '/items?item=' || s.id::text,
             l.payee_name_raw || COALESCE(' · check #' || l.reference_number, '') || ' · $' || to_char(s.amount_cents / 100.0, 'FM999,999,999,990.00')
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id JOIN ledger_items l ON l.id = s.ledger_item_id WHERE o.company_id = ${c}
      UNION ALL
      SELECT r.id::text, r.state, '/reports?state=' || r.state, r.state || ' ' || r.report_year::text || ' holder report' FROM reports r WHERE r.company_id = ${c}
      UNION ALL
      SELECT rc.id::text, rc.state, '/recoveries', rc.state || ' recovery' FROM recoveries rc WHERE rc.company_id = ${c}
      UNION ALL
      SELECT co.id::text, NULL::text, '/recoveries', NULL::text FROM companies co WHERE co.id = ${c}
      UNION ALL
      SELECT g.id::text, g.state, '/rules?state=' || g.state, g.state || ' rule change' FROM rule_changes g WHERE g.state IN (SELECT state FROM company_states)
    ),
    approval_fk AS (
      SELECT approval_id FROM outreach WHERE company_id = ${c} AND approval_id IS NOT NULL
      UNION SELECT approval_id FROM reports WHERE company_id = ${c} AND approval_id IS NOT NULL
      UNION SELECT approval_id FROM recoveries WHERE company_id = ${c} AND approval_id IS NOT NULL
    ),
    scoped_approvals AS (
      SELECT a.*, x.state AS subj_state, COALESCE(x.href, '/approvals') AS subj_href, x.label AS subj_label
        FROM approvals a LEFT JOIN subj x ON x.sid = a.subject_id
       WHERE x.sid IS NOT NULL OR a.id IN (SELECT approval_id FROM approval_fk)
    ),
    ev AS (
      SELECT 'approval:' || a.id::text || ':approved' AS uid, a.approved_at AS at, 'approval' AS kind,
             'Approved: ' || replace(a.action::text, '_', ' ') AS title,
             COALESCE(a.subj_label, 'Subject record no longer available') AS detail, a.approved_by AS actor, a.subj_state AS state,
             a.subj_href AS href, left(a.payload_sha256, 12) AS payload_hash, false AS attention
        FROM scoped_approvals a WHERE a.approved_at IS NOT NULL AND a.action <> 'discard_draft'
      UNION ALL
      SELECT 'approval:' || a.id::text || ':discarded', a.approved_at, 'approval',
             'Discarded the ' || CASE o.channel::text WHEN 'letter' THEN 'due-diligence letter' WHEN 'email' THEN 'due-diligence email' ELSE o.channel::text END
               || ' draft' || COALESCE(' for ' || NULLIF(l.payee_name_raw, ''), ''),
             'Reason: ' || COALESCE(NULLIF(a.reason, ''), 'none given') || ' · Nothing was sent',
             a.approved_by, a.subj_state, a.subj_href, left(a.payload_sha256, 12), false
        FROM scoped_approvals a
        JOIN outreach o ON o.id::text = a.subject_id
        JOIN stale_items si ON si.id = o.stale_item_id
        JOIN ledger_items l ON l.id = si.ledger_item_id
       WHERE a.action = 'discard_draft' AND a.approved_at IS NOT NULL
      UNION ALL
      SELECT 'approval:' || a.id::text || ':consumed', a.consumed_at, 'approval',
             'Approval used: ' || replace(a.action::text, '_', ' '),
             COALESCE(a.subj_label, 'Subject record no longer available'), a.approved_by, a.subj_state, a.subj_href, left(a.payload_sha256, 12), false
        FROM scoped_approvals a WHERE a.consumed_at IS NOT NULL AND a.action <> 'discard_draft'
      UNION ALL
      SELECT 'outreach:' || o.id::text || ':drafted', o.created_at, 'outreach',
             initcap(o.channel::text) || ' drafted', COALESCE(x.label || ' · ', '') || 'Current status: ' || o.status::text || CASE WHEN o.offline THEN ' (offline)' ELSE '' END,
             NULL::text, s.owner_state, '/items?item=' || s.id::text, NULL::text, (o.status = 'failed')
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id LEFT JOIN subj x ON x.sid = o.id::text WHERE o.company_id = ${c}
      UNION ALL
      SELECT 'outreach:' || o.id::text || ':sent', o.sent_at, 'outreach',
             initcap(o.channel::text) || ' sent', COALESCE(x.label || ' · ', '') || 'Current status: ' || o.status::text || CASE WHEN o.offline THEN ' (offline)' ELSE '' END,
             NULL::text, s.owner_state, '/items?item=' || s.id::text, NULL::text, false
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id LEFT JOIN subj x ON x.sid = o.id::text WHERE o.company_id = ${c} AND o.sent_at IS NOT NULL
      UNION ALL
      SELECT 'outreach:' || o.id::text || ':responded', o.responded_at, 'outreach',
             'Owner responded to ' || o.channel::text, x.label,
             NULL::text, s.owner_state, '/items?item=' || s.id::text, NULL::text, false
        FROM outreach o JOIN stale_items s ON s.id = o.stale_item_id LEFT JOIN subj x ON x.sid = o.id::text WHERE o.company_id = ${c} AND o.responded_at IS NOT NULL
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
      SELECT 'run:' || ar.id::text, COALESCE(ar.finished_at, ar.started_at), 'run',
             CASE
               WHEN ar.status = 'succeeded' THEN 'Agent run completed: '
               WHEN ar.status = 'failed' THEN 'Agent run failed: '
               WHEN ar.status = 'cancelled' AND ar.error LIKE 'Offline%' THEN 'Agent run skipped (offline): '
               WHEN ar.status = 'cancelled' THEN 'Agent run stopped: '
               ELSE 'Agent run in progress: '
             END || initcap(replace(ar.agent, '_', ' ')),
             concat_ws(' · ',
               CASE WHEN ar.finished_at IS NOT NULL THEN 'Took ' || CASE
                 WHEN ar.finished_at - ar.started_at < interval '1 second' THEN (round(extract(epoch FROM ar.finished_at - ar.started_at) * 1000))::text || ' ms'
                 WHEN ar.finished_at - ar.started_at < interval '1 minute' THEN to_char(extract(epoch FROM ar.finished_at - ar.started_at), 'FM990.0') || ' s'
                 ELSE (floor(extract(epoch FROM ar.finished_at - ar.started_at) / 60))::text || ' min ' || (round(extract(epoch FROM ar.finished_at - ar.started_at))::bigint % 60)::text || ' s' END END,
               CASE WHEN ar.input->>'mode' = 'replay' THEN 'Replay (offline), not billed'
                    WHEN ar.model IS NOT NULL AND ar.model <> 'scripted' THEN 'Model ' || ar.model END,
               CASE
                 WHEN ar.error IS NULL THEN NULL
                 WHEN ar.error LIKE 'OfflineCassetteMissing%' THEN 'No recorded answer (offline)'
                 WHEN ar.error LIKE 'OfflineDataDrift%' THEN 'Recorded answer no longer matches current data (offline)'
                 ELSE 'The run did not complete. Open it for details.'
               END),
             CASE WHEN ar.agent = 'chat' THEN 'via chat' END, s.owner_state,
             '/runs/' || ar.id::text, NULL::text, (ar.status = 'failed')
        FROM agent_runs ar LEFT JOIN stale_items s ON s.id = ar.stale_item_id WHERE ar.company_id = ${c}
      UNION ALL
      SELECT 'payee:' || p.id::text || ':reviewed', p.reviewed_at, 'payee',
             CASE p.review_action WHEN 'merge' THEN 'Payees merged into ' WHEN 'split' THEN 'Payee split out: ' WHEN 'rename' THEN 'Payee renamed to ' ELSE 'Payee reviewed: ' END || p.canonical_name,
             concat_ws(' · ',
               CASE WHEN cardinality(p.aliases) > 0 THEN 'Also known as ' || array_to_string(p.aliases, ', ') END,
               (SELECT count(*) FROM stale_items si WHERE si.owner_payee_id = p.id)::text || ' items now under this payee'),
             p.reviewed_by, p.state, '/payees', NULL::text, false
        FROM payees p WHERE p.company_id = ${c} AND p.reviewed_at IS NOT NULL
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
    )`
}

/**
 * R9-02: the demo clock's own rows, read from demo_clock_events and nothing else. One row per jump (dated by the demo
 * day stored on the event, not looked up from the real clock, so two jumps in the same minute stay on their own days),
 * plus a "Detected" row when the move found newly stale items and a "removed" row when moving back took detections out.
 * A removal is its own row; nothing already recorded disappears. Rows written before the event details existed
 * (prev_day IS NULL) show the jump only, with the previous day taken from the row before it.
 */
function clockEventsCte(companyId: string): SQL {
  const c = sql`${companyId}::uuid`;
  const money = (col: string) => sql.raw(`'$' || to_char(${col} / 100.0, 'FM999,999,999,990.00')`);
  return sql`
    clock_src AS (
      SELECT id, set_at, demo_day, kind, detected_count, detected_cents, undetected_count,
             COALESCE(prev_day, lag(demo_day) OVER (ORDER BY set_at, id)) AS prev_day
        FROM demo_clock_events WHERE company_id = ${c}
    ),
    clock_ev AS (
      SELECT 'clock:' || ce.id::text || ':move' AS uid, ce.set_at AS at, 'clock' AS kind,
             CASE WHEN ce.kind = 'reset' THEN 'Demo clock reset to ' WHEN ce.demo_day > ce.prev_day THEN 'Demo clock moved forward to ' ELSE 'Demo clock moved back to ' END
               || to_char(ce.demo_day, 'Mon FMDD, YYYY') AS title,
             'From ' || to_char(ce.prev_day, 'Mon FMDD, YYYY') || ' · '
               || CASE WHEN ce.demo_day > ce.prev_day THEN '+' ELSE '-' END || abs(ce.demo_day - ce.prev_day)::text
               || CASE WHEN abs(ce.demo_day - ce.prev_day) = 1 THEN ' day' ELSE ' days' END
               || CASE WHEN ce.kind = 'reset' THEN ' · statuses recomputed at the anchor date' ELSE ' · deadlines recomputed' END AS detail,
             NULL::text AS actor, NULL::text AS state, '/dashboard' AS href, NULL::text AS payload_hash, false AS attention,
             to_char(ce.demo_day, 'YYYY-MM-DD') AS demo_day
        FROM clock_src ce WHERE ce.prev_day IS NOT NULL AND ce.prev_day <> ce.demo_day
      UNION ALL
      SELECT 'clock:' || ce.id::text || ':detected', ce.set_at, 'clock',
             'Detected ' || ce.detected_count::text || ' newly stale item' || CASE WHEN ce.detected_count = 1 THEN '' ELSE 's' END,
             'Crossed the business stale line when the demo clock moved · ' || ${money("ce.detected_cents")} || ' added to the liability',
             NULL::text, NULL::text, '/items', NULL::text, false, to_char(ce.demo_day, 'YYYY-MM-DD')
        FROM clock_src ce WHERE ce.detected_count > 0
      UNION ALL
      SELECT 'clock:' || ce.id::text || ':undetected', ce.set_at, 'clock',
             CASE WHEN ce.kind = 'reset' THEN 'Clock reset' ELSE 'Clock moved back' END
               || ' · ' || ce.undetected_count::text || ' detection' || CASE WHEN ce.undetected_count = 1 THEN '' ELSE 's' END || ' removed',
             'Items an earlier clock move detected are not stale yet on ' || to_char(ce.demo_day, 'Mon FMDD, YYYY')
               || ', so they left the pipeline (only items nobody had acted on). The earlier detection rows stay in this record.',
             NULL::text, NULL::text, '/items', NULL::text, false, to_char(ce.demo_day, 'YYYY-MM-DD')
        FROM clock_src ce WHERE ce.undetected_count > 0
    )`;
}

/** SQL for the demo date of a timestamp expression: the last clock change at or before it, else the legacy clamp. */
function demoDaySql(atExpr: SQL, clock: ActivityClock | undefined): SQL {
  const utcDay = sql`to_char(${atExpr} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  if (!clock) return utcDay;
  if (!clock.history.length) return sql`LEAST(${utcDay}, ${clock.today}::text)`;
  // R8-09: an event before the first logged change (the seed's rows, written just before it sets the clock) belongs on
  // or before that first demo day (and today's), never on a later real date once the clock has jumped ahead.
  const clamped = sql`LEAST(${utcDay}, ${clock.history[0]!.day}::text, ${clock.today}::text)`;
  return sql`COALESCE((SELECT cs.day FROM clock_steps cs WHERE cs.set_at <= ${atExpr} ORDER BY cs.set_at DESC LIMIT 1), ${clamped})`;
}

/** `ev` plus `evd`: every event with its demo day, computed in SQL from the clock log (loaded once by the caller). */
function activityCte(companyId: string, clock: ActivityClock | undefined): SQL {
  const steps = clock?.history ?? [];
  const clockCte = steps.length
    ? sql`clock_steps(set_at, day) AS (VALUES ${sql.join(steps.map((st) => sql`(to_timestamp(${st.atMs}::double precision / 1000.0), ${st.day}::text)`), sql`, `)})`
    : sql`clock_steps(set_at, day) AS (SELECT NULL::timestamptz, NULL::text WHERE false)`;
  return sql`${eventsCte(companyId)}, ${clockCte}, ${clockEventsCte(companyId)},
    evd AS (SELECT ev.*, ${demoDaySql(sql`ev.at`, clock)} AS demo_day FROM ev WHERE ev.at IS NOT NULL
            UNION ALL SELECT * FROM clock_ev)`;
}

interface Row {
  uid: string;
  at_iso: string;
  demo_day: string;
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
  if (f.from && isRealDate(f.from)) conds.push(sql`demo_day >= ${f.from}::text`);
  if (f.to && isRealDate(f.to)) conds.push(sql`demo_day <= ${f.to}::text`);
  const q = f.q?.trim().slice(0, MAX_TEXT_LEN).toLowerCase();
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    conds.push(
      sql`lower(title || ' ' || COALESCE(detail, '') || ' ' || COALESCE(actor, '') || ' ' || COALESCE(state, '') || ' ' || COALESCE(payload_hash, '')) LIKE ${pat} ESCAPE '\\'`,
    );
  }
  if (cursor) conds.push(sql`(demo_day, at, uid) < (${demoDaySql(sql`${cursor.atIso}::timestamptz`, f.clock)}, ${cursor.atIso}::timestamptz, ${cursor.uid}::text)`);
  return sql.join(conds, sql` AND `);
}

/**
 * One page of the company's activity, newest demo day first, then newest real time (ties broken by event id,
 * descending). Sorting by demo day keeps every demo day in one contiguous group even when the clock jumped back and forth. Keyset pagination: pass the
 * previous page's `nextCursor`. `limit` is clamped to 1..MAX_ACTIVITY_LIMIT.
 */
export async function listActivity(db: Db, companyId: string, query: ActivityQuery = {}): Promise<ActivityPage> {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_ACTIVITY_LIMIT) || DEFAULT_ACTIVITY_LIMIT, 1), MAX_ACTIVITY_LIMIT);
  const cursor = decodeCursor(query.cursor);
  const statement = sql`
    WITH ${activityCte(companyId, query.clock)}
    SELECT uid, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_iso, demo_day,
           kind, title, detail, actor, state, href, payload_hash, attention
      FROM evd
     WHERE ${whereClause(query, cursor)}
     ORDER BY demo_day DESC, at DESC, uid DESC
     LIMIT ${limit + 1}`;
  const res = (await db.execute(statement)) as unknown as { rows?: Row[] } | Row[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  const page = rows.slice(0, limit);
  const entries: ActivityEntry[] = page.map((r) => ({
    id: r.uid,
    at: new Date(r.at_iso),
    demoDay: r.demo_day,
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

/* ------------------------------------------------------------------ day density ------------------------------------------------------------------ */

export const DENSITY_DAYS = 30;

export interface ActivityDayCount {
  /** Demo day, YYYY-MM-DD. */
  day: string;
  count: number;
  /** Entries on that day marked `attention` (failures, rejections). */
  attention: number;
}

export interface ActivityHourCount {
  /** UTC hour 0-23. */
  hour: number;
  count: number;
  attention: number;
}

/** Pure: exactly 24 hourly buckets (0-23), zero-filled, from sparse rows. Rows with an out-of-range hour are ignored. */
export function buildHourly(rows: readonly ActivityHourCount[]): ActivityHourCount[] {
  const byHour = new Map(rows.filter((r) => Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23).map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour)?.count ?? 0, attention: byHour.get(hour)?.attention ?? 0 }));
}

export interface ActivityDensity {
  /** Inclusive UTC window, oldest first; `days.length === DENSITY_DAYS` (or the requested span). */
  from: string;
  to: string;
  days: ActivityDayCount[];
  /** Entries inside the window. */
  total: number;
  /** Day with the most entries in the window, or null when the window is empty. */
  peak: ActivityDayCount | null;
}

const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Pure: a gap-free run of `span` days ending at `endDay`, with counts from `rows` (any order, days outside are ignored).
 * The window ends at `endDay`; callers pass the `to` filter, else the newest matching day, else today.
 */
export function buildDensity(rows: readonly ActivityDayCount[], endDay: string, span = DENSITY_DAYS): ActivityDensity {
  const n = Math.max(1, Math.min(366, Math.trunc(span) || DENSITY_DAYS));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const from = addDaysIso(endDay, -(n - 1));
  const days = Array.from({ length: n }, (_, i) => {
    const day = addDaysIso(from, i);
    const r = byDay.get(day);
    return { day, count: r?.count ?? 0, attention: r?.attention ?? 0 };
  });
  const total = days.reduce((a, d) => a + d.count, 0);
  const peak = total === 0 ? null : days.reduce((best, d) => (d.count > best.count ? d : best), days[0]!);
  return { from, to: endDay, days, total, peak };
}

const MS_PER_DAY = 86_400_000;
const MAX_DENSITY_SPAN = 366;

/** Pure: days from `oldest` to `end` inclusive, at least DENSITY_DAYS and at most a year. */
export function densitySpan(oldest: string, end: string): number {
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / MS_PER_DAY) + 1;
  return Math.min(MAX_DENSITY_SPAN, Math.max(DENSITY_DAYS, days));
}

interface DayRow {
  day: string;
  n: number | string;
  a: number | string;
}

/**
 * Entries per demo day for the same filters as the list (kind, state, text), over the list's own range: it ends at
 * the `to` filter if set, else at the newest matching entry, else today, and starts at the oldest matching demo day. The `from` filter does not narrow the strip:
 * the UI shades days outside the chosen range instead, so the context stays visible.
 */
export async function activityDensity(db: Db, companyId: string, filters: ActivityFilters = {}, today = filters.clock?.today ?? new Date().toISOString().slice(0, 10)): Promise<ActivityDensity> {
  const base: ActivityQuery = { kinds: filters.kinds, state: filters.state, q: filters.q, clock: filters.clock };
  const statement = sql`
    WITH ${activityCte(companyId, filters.clock)}
    SELECT demo_day AS day, count(*) AS n, count(*) FILTER (WHERE attention) AS a
      FROM evd
     WHERE ${whereClause(base, null)}
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 400`;
  const res = (await db.execute(statement)) as unknown as { rows?: DayRow[] } | DayRow[];
  const raw = Array.isArray(res) ? res : (res.rows ?? []);
  const rows = raw.map((r) => ({ day: r.day, count: Number(r.n), attention: Number(r.a) }));
  const end = filters.to && isRealDate(filters.to) ? filters.to : (rows[0]?.day ?? today);
  // R9-10: the strip covers the same range as the list, not a fixed 30 days: from the oldest matching demo day up to
  // `end` (capped at a year; planStrip drops empty edges and folds long quiet stretches into labelled gaps).
  const oldest = rows.reduce<string | null>((o, r) => (r.day <= end && (o === null || r.day < o) ? r.day : o), null);
  return buildDensity(rows, end, oldest ? densitySpan(oldest, end) : DENSITY_DAYS);
}

interface HourRow {
  h: number | string;
  n: number | string;
  a: number | string;
}

/**
 * Entries per real UTC hour (the clock time each row was written, not a demo time) of one demo day, for the same kind/state/text filters as the list. Used when every matching
 * entry falls on a single day (a demo seed), so the strip can show that day by hour instead of one lonely spike.
 */
export async function activityHours(db: Db, companyId: string, filters: ActivityFilters, day: string): Promise<ActivityHourCount[]> {
  if (!isRealDate(day)) return buildHourly([]);
  const base: ActivityQuery = { kinds: filters.kinds, state: filters.state, q: filters.q, from: day, to: day, clock: filters.clock };
  const statement = sql`
    WITH ${activityCte(companyId, filters.clock)}
    SELECT extract(hour FROM at AT TIME ZONE 'UTC')::int AS h, count(*) AS n, count(*) FILTER (WHERE attention) AS a
      FROM evd
     WHERE ${whereClause(base, null)}
     GROUP BY 1
     ORDER BY 1`;
  const res = (await db.execute(statement)) as unknown as { rows?: HourRow[] } | HourRow[];
  const raw = Array.isArray(res) ? res : (res.rows ?? []);
  return buildHourly(raw.map((r) => ({ hour: Number(r.h), count: Number(r.n), attention: Number(r.a) })));
}
