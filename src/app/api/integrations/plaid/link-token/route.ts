import { NextResponse } from "next/server";
import { requirePlaid } from "@/lib/integrations/config";
import { companyFromRequest, errorResponse } from "@/lib/integrations/http";
import { createLinkToken } from "@/lib/integrations/plaid/client";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const cfg = requirePlaid();
    const ctx = await companyFromRequest(request);
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ linkToken: await createLinkToken(cfg, ctx.companyId) });
  } catch (err) {
    return errorResponse(err, "plaid-link-token");
  }
}
