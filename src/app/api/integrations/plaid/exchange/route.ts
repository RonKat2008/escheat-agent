import { NextResponse } from "next/server";
import { requirePlaid } from "@/lib/integrations/config";
import { companyFromRequest, errorResponse } from "@/lib/integrations/http";
import { createSandboxPublicToken, defaultPlaidDeps, exchangePublicToken } from "@/lib/integrations/plaid/client";

/** Body: { publicToken } from Plaid Link, or { sandbox: true } to skip Link (sandbox shortcut). */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const cfg = requirePlaid();
    const ctx = await companyFromRequest(request);
    if (ctx instanceof NextResponse) return ctx;
    const publicToken =
      typeof ctx.body.publicToken === "string" && ctx.body.publicToken
        ? ctx.body.publicToken
        : ctx.body.sandbox === true
          ? await createSandboxPublicToken(cfg)
          : undefined;
    if (!publicToken) return NextResponse.json({ error: "publicToken or sandbox:true required" }, { status: 400 });
    const { store } = defaultPlaidDeps(ctx.db);
    await exchangePublicToken(cfg, store, { companyId: ctx.companyId, publicToken });
    return NextResponse.json({ connected: true });
  } catch (err) {
    return errorResponse(err, "plaid-exchange");
  }
}
