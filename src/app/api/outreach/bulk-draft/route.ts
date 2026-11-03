import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionGuard } from "@/lib/auth/session";
import { BULK_MAX, bulkDraftOutreach, planBulkDraftFromDb } from "@/lib/outreach/bulk";
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
  dryRun: z.boolean().optional(),
});

const TRUTHY = new Set(["1", "true"]);

/**
 * Drafts outreach for many items via the per-item draft path, after a pre-flight that skips items that can never be
 * approved (unknown rule values, windows not open, closed, already drafted, no owner address). Drafts wait in
 * /approvals; nothing is sent. `dryRun` (body flag or ?dryRun=1) returns the plan and writes nothing.
 * Response shapes are documented at the top of src/lib/outreach/bulk.ts.
 */
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
    const dryRun = body.dryRun === true || TRUTHY.has(new URL(request.url).searchParams.get("dryRun") ?? "");
    const db = await getOutreachDb();
    const args = { companyId: await getDefaultCompanyId(db), channel: body.channel, staleItemIds: body.staleItemIds };
    if (dryRun) {
      const { plan, summary } = await planBulkDraftFromDb(db, args);
      return NextResponse.json({ dryRun: true, channel: body.channel, plan, summary });
    }
    const results = await bulkDraftOutreach(db, args);
    const skippedByReason: Record<string, number> = {};
    for (const r of results) if (r.status === "skipped") skippedByReason[r.code] = (skippedByReason[r.code] ?? 0) + 1;
    const drafted = results.filter((r) => r.status === "drafted").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    return NextResponse.json({ results, summary: { drafted, skipped, failed: results.length - drafted - skipped, skippedByReason } });
  } catch (err) {
    return errorResponse(err);
  }
}
