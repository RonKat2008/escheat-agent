import { NextResponse } from "next/server";
import { requireQbo } from "@/lib/integrations/config";
import { companyFromRequest, errorResponse } from "@/lib/integrations/http";
import { pullQboChecks } from "@/lib/integrations/qbo/pull";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireQbo();
    const ctx = await companyFromRequest(request);
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await pullQboChecks(ctx.db, ctx.companyId));
  } catch (err) {
    return errorResponse(err, "qbo-pull");
  }
}
