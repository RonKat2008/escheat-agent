import { NextResponse } from "next/server";
import { requireQbo } from "@/lib/integrations/config";
import { companyFromRequest, errorResponse } from "@/lib/integrations/http";
import { pullQboChecks } from "@/lib/integrations/qbo/pull";
import { sessionGuard } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    requireQbo();
    const ctx = await companyFromRequest(request);
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await pullQboChecks(ctx.db, ctx.companyId));
  } catch (err) {
    return errorResponse(err, "qbo-pull");
  }
}
