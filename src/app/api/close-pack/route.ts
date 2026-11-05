import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { approverNameSchema } from "@/lib/auth/approver";
import { approverLabel, authErrorResponse, requireSession, sessionGuard, type Session } from "@/lib/auth/session";
import { serviceErrorResponse } from "@/lib/b-http";
import { now as clockNow } from "@/lib/clock";
import { buildClosePack } from "@/lib/close-pack/build";
import { CloseError, closePeriod, loadClosedPack } from "@/lib/close-pack/close";
import { isMonthId } from "@/lib/close-pack/period";
import { resolveCompanyId } from "@/lib/pipeline/company";

/**
 * GET /api/close-pack?period=YYYY-MM: the month-end close pack as a ZIP (journal CSV, roll-forward PDF, audit binder,
 * Activity CSV, tie-out PDF, manifest.json). The period defaults to the demo clock's month. Read-only: a file only,
 * nothing is posted or sent. For a CLOSED month (POST below) the ZIP is the frozen one handed out at close,
 * byte-identical on every download. Passcode-gated like the other APIs.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("period");
  if (raw !== null && !isMonthId(raw)) {
    return NextResponse.json({ error: "period must be YYYY-MM", code: "bad_period" }, { status: 400 });
  }
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const ym = raw ?? (await clockNow(db, companyId)).slice(0, 7);
    const frozen = await loadClosedPack(db, companyId, ym);
    if (frozen) {
      return new Response(Buffer.from(frozen.zip), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="escheat-close-pack-${ym}.zip"`,
          "cache-control": "no-store",
          "x-close-pack-files": String(frozen.fileCount),
          "x-close-pack-ties": frozen.allTie ? "true" : "false",
          "x-close-pack-closed": "true",
          "x-close-pack-manifest-sha256": frozen.manifestSha256,
        },
      });
    }
    const result = await buildClosePack(db, companyId, ym);
    if (!result.ok) return NextResponse.json({ error: result.error, code: "bad_period" }, { status: result.status });
    const { pack } = result;
    return new Response(Buffer.from(pack.zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="escheat-close-pack-${pack.manifest.period}.zip"`,
        "cache-control": "no-store",
        "x-close-pack-files": String(pack.files.length),
        "x-close-pack-ties": pack.manifest.tieOut.allTie ? "true" : "false",
      },
    });
  } catch (err) {
    console.error("[api] close pack failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const CloseBody = z.object({
  period: z.string().refine(isMonthId, "period must be YYYY-MM"),
  approvedBy: approverNameSchema,
  expectedJournalSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * POST /api/close-pack: close a month (R10-01). IRREVERSIBLE and human-approved: the typed name is bound to the exact
 * journal the person reviewed (expectedJournalSha256), the approval is consumed once, the pack's manifest hash goes into
 * the audit chain and the month's journal and pack are frozen. Nothing is posted anywhere. Synthetic demo data only.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  try {
    const body = CloseBody.parse(await request.json().catch(() => ({})));
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const res = await closePeriod(db, { companyId, period: body.period, approvedBy: approverLabel(session, body.approvedBy), expectedJournalSha256: body.expectedJournalSha256 });
    try {
      revalidatePath("/ledger");
      revalidatePath("/activity");
    } catch {
      // outside a Next request scope
    }
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    if (err instanceof CloseError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return serviceErrorResponse(err);
  }
}
