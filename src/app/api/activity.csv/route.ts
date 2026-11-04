import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { loadClockHistory } from "@/lib/clock-history";
import { toCsv } from "@/lib/csv";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { listActivity, parseActivityParams, type ActivityEntry } from "@/lib/queries/activity";

const PAGE = 200;
/** Hard ceiling so one request can never stream an unbounded table. */
const MAX_ROWS = 5000;

export const CSV_HEADER = ["timestamp_utc", "demo_day", "kind", "title", "detail", "actor", "state", "payload_sha256_prefix", "needs_attention", "link", "event_id"] as const;

const toRow = (e: ActivityEntry) => [e.at.toISOString(), e.demoDay, e.kind, e.title, e.detail, e.actor, e.state, e.payloadHash, e.attention ? "yes" : "no", e.href, e.id];

/** Export of the filtered activity log. Same filters as /activity (the cursor is ignored). Passcode-gated like other APIs. */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { cursor: _ignored, ...filters } = parseActivityParams(params);
    void _ignored;
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });

    // Activity is a demo-calendar view: filters and the demo_day column use the demo day each event happened on.
    const [today, history] = await Promise.all([now(db, companyId), loadClockHistory(db, companyId)]);
    const clock = { history, today };

    const rows: ActivityEntry[] = [];
    let cursor: string | null = null;
    let truncated = false;
    do {
      const page = await listActivity(db, companyId, { ...filters, clock, cursor, limit: PAGE });
      rows.push(...page.entries);
      cursor = page.nextCursor;
      if (rows.length >= MAX_ROWS) {
        truncated = Boolean(cursor);
        break;
      }
    } while (cursor);

    return new Response(toCsv(CSV_HEADER, rows.slice(0, MAX_ROWS).map(toRow)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="activity.csv"',
        "cache-control": "no-store",
        "x-activity-truncated": truncated ? "true" : "false",
      },
    });
  } catch (err) {
    console.error("[api] activity export failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
