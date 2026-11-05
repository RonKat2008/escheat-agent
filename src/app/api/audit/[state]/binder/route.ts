import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { buildAuditBinder } from "@/lib/audit/binder";
import { verifyChain } from "@/lib/audit/chain-db";
import { AUDIT_STATES, DEFAULT_SAMPLE_SIZE, SAMPLE_SIZES } from "@/lib/audit/sample";
import { sessionGuard } from "@/lib/auth/session";
import { serviceErrorResponse } from "@/lib/b-http";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { loadAuditDrill } from "@/lib/queries/audit";

const Query = z.object({
  state: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(AUDIT_STATES)),
  size: z.coerce
    .number()
    .int()
    .refine((n) => (SAMPLE_SIZES as readonly number[]).includes(n), `size must be one of ${SAMPLE_SIZES.join(", ")}`)
    .default(DEFAULT_SAMPLE_SIZE),
  all: z.enum(["true", "false", "1", "0"]).optional(),
});

/**
 * GET /api/audit/:state/binder?size=5&all=true: the Audit Drill binder PDF, one page per sampled item. The same
 * deterministic sample as /audit. Read-only (nothing is written or sent). Behind the passcode session like every API route.
 */
export async function GET(request: Request, ctx: { params: Promise<{ state: string }> }): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const parsed = Query.safeParse({
    state: (await ctx.params).state,
    size: url.searchParams.get("size") ?? undefined,
    all: url.searchParams.get("all") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const all = parsed.data.all === "true" || parsed.data.all === "1";
    const drill = await loadAuditDrill(db, companyId, { state: parsed.data.state, size: parsed.data.size, all });
    const chain = await verifyChain(db, companyId);
    const bytes = await buildAuditBinder({ ...drill, chain });
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="audit-binder-${drill.state}-${drill.today}.pdf"`,
        "cache-control": "no-store",
        "x-audit-seed": drill.seed,
        "x-audit-chain-head": chain.headHash,
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
