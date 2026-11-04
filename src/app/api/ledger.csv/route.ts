import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { journalCsv } from "@/lib/ledger/csv";
import { DEFAULT_PERIOD, PERIOD_IDS, type PeriodId } from "@/lib/ledger/rollforward";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";

/** Hard ceiling so one request can never stream an unbounded file (JE lines). */
const MAX_ROWS = 5000;

/**
 * "Export JE CSV": the /ledger journal for a period as a file (Date, JE#, Account, Debit, Credit, Memo, Ref). A file
 * only: nothing is posted and no accounting system is connected. Passcode-gated like the other APIs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("period");
  if (raw !== null && !(PERIOD_IDS as readonly string[]).includes(raw)) {
    return NextResponse.json({ error: `period must be one of ${PERIOD_IDS.join(", ")}`, code: "bad_period" }, { status: 400 });
  }
  const period = (raw ?? DEFAULT_PERIOD) as PeriodId;
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const view = computeLedger(await loadLedger(db, companyId), period);
    const lines = view.journal.entries.reduce((n, e) => n + e.lines.length, 0);
    if (lines > MAX_ROWS) return NextResponse.json({ error: `More than ${MAX_ROWS} journal lines; pick a shorter period.`, code: "too_large" }, { status: 413 });
    const { start, end } = view.roll.period;
    return new Response(journalCsv(view.journal.entries), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="escheat-je-${period}-${start}-to-${end}.csv"`,
        "cache-control": "no-store",
        "x-ledger-balanced": view.journal.balanced ? "true" : "false",
      },
    });
  } catch (err) {
    console.error("[api] ledger export failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
