import { NextResponse } from "next/server";
import { z } from "zod";
import { approverNameSchema } from "@/lib/auth/approver";
import { approverLabel, authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { BULK_MAX, bulkApproveOutreach } from "@/lib/outreach/bulk";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { getDefaultCompanyId } from "@/lib/queries";

const Item = z.object({
  outreachId: z.string().uuid(),
  expectedContentSha256: z.string().regex(/^[0-9a-f]{64}$/, "expected hash required"),
  to: z.string().trim().min(1).max(320).optional(),
});
const Body = z.object({
  channel: z.enum(["letter", "email", "voice"]),
  approvedBy: approverNameSchema,
  items: z
    .array(Item)
    .min(1)
    .max(BULK_MAX, `At most ${BULK_MAX} items per request`)
    .refine((xs) => new Set(xs.map((x) => x.outreachId)).size === xs.length, "Duplicate items in request"),
});

/**
 * Records one in-app approval PER item (own payload sha256, own re-validation, same approver field as the single
 * endpoint) and returns per-item success or failure. It never sends, mails or calls anything.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  try {
    const body = Body.parse(json);
    const db = await getOutreachDb();
    const results = await bulkApproveOutreach(db, {
      companyId: await getDefaultCompanyId(db),
      channel: body.channel,
      approvedBy: approverLabel(session, body.approvedBy),
      items: body.items,
    });
    const approved = results.filter((r) => r.ok).length;
    return NextResponse.json({ results, summary: { approved, failed: results.length - approved } });
  } catch (err) {
    return errorResponse(err);
  }
}
