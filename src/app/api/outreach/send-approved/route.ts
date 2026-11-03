import { NextResponse } from "next/server";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { sendAllApproved } from "@/lib/outreach/send-all";
import { getDefaultCompanyId } from "@/lib/queries";

/**
 * "Send all approved": runs the single-item executor for every approved outreach (each asserts its own approval,
 * allowlist and Lob test-key guard). Returns per-item outcomes; offline runs are reported as offline, not sent.
 * Body is ignored: there is nothing to choose, only approved rows are eligible.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  try {
    const db = await getOutreachDb();
    const result = await sendAllApproved(db, await getDefaultCompanyId(db), { requestedBy: approverLabel(session, "Send all approved") });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
