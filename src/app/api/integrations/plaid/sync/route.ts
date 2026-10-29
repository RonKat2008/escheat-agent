import { NextResponse } from "next/server";
import { requirePlaid } from "@/lib/integrations/config";
import { companyFromRequest, errorResponse } from "@/lib/integrations/http";
import { syncPlaidClears } from "@/lib/integrations/plaid/sync";
import { sessionGuard } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    requirePlaid();
    const ctx = await companyFromRequest(request);
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await syncPlaidClears(ctx.db, ctx.companyId));
  } catch (err) {
    return errorResponse(err, "plaid-sync");
  }
}
