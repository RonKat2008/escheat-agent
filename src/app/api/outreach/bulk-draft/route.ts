import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionGuard } from "@/lib/auth/session";
import { BULK_MAX, bulkDraftOutreach } from "@/lib/outreach/bulk";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { getDefaultCompanyId } from "@/lib/queries";

const Body = z.object({
  channel: z.enum(["letter", "email", "voice"]).default("letter"),
  staleItemIds: z
    .array(z.string().uuid())
    .min(1)
    .max(BULK_MAX, `At most ${BULK_MAX} items per request`)
    .refine((xs) => new Set(xs).size === xs.length, "Duplicate items in request"),
});

/** Drafts outreach for many items via the per-item draft path. Drafts wait in /approvals; nothing is sent. */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  try {
    const body = Body.parse(json);
    const db = await getOutreachDb();
    const results = await bulkDraftOutreach(db, {
      companyId: await getDefaultCompanyId(db),
      channel: body.channel,
      staleItemIds: body.staleItemIds,
    });
    const drafted = results.filter((r) => r.status === "drafted").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    return NextResponse.json({ results, summary: { drafted, skipped, failed: results.length - drafted - skipped } });
  } catch (err) {
    return errorResponse(err);
  }
}
