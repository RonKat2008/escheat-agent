import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionGuard } from "@/lib/auth/session";
import { BULK_MAX, composeAllDrafts } from "@/lib/outreach/bulk";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { getDefaultCompanyId } from "@/lib/queries";

const Body = z.object({
  channel: z.enum(["letter", "email", "voice"]).default("letter"),
  outreachIds: z
    .array(z.string().uuid())
    .min(1)
    .max(BULK_MAX, `At most ${BULK_MAX} drafts per request`)
    .refine((xs) => new Set(xs).size === xs.length, "Duplicate drafts in request")
    .optional(),
});

/**
 * Composes every draft that has not been composed yet and re-runs readiness. It records no approval and sends nothing;
 * approval still needs a human, the reviewed content hash and the per-item checks. Shapes: top of src/lib/outreach/bulk.ts.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  let json: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }
  }
  try {
    const body = Body.parse(json);
    const db = await getOutreachDb();
    const { results, remaining } = await composeAllDrafts(db, {
      companyId: await getDefaultCompanyId(db),
      channel: body.channel,
      outreachIds: body.outreachIds,
    });
    const composed = results.filter((r) => r.status === "composed");
    const ready = composed.filter((r) => r.status === "composed" && r.ready).length;
    return NextResponse.json({
      results,
      summary: { composed: composed.length, ready, blocked: composed.length - ready, failed: results.length - composed.length, remaining },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
