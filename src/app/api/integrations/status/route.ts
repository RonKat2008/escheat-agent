import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { plaidConfig, qboConfig } from "@/lib/integrations/config";
import { errorResponse, resolveCompanyId } from "@/lib/integrations/http";
import { drizzleRawStore } from "@/lib/integrations/store";
import { sessionGuard } from "@/lib/auth/session";

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db, new URL(request.url).searchParams.get("companyId"));
    const raw = drizzleRawStore(db);
    const [qbo, plaid] = companyId
      ? await Promise.all([raw.get(companyId, "qbo"), raw.get(companyId, "plaid")])
      : [undefined, undefined];
    return NextResponse.json({
      companyId: companyId ?? null,
      qbo: { configured: Boolean(qboConfig()), connected: Boolean(qbo?.accessTokenEnc), realmId: qbo?.realmId ?? null },
      plaid: { configured: Boolean(plaidConfig()), connected: Boolean(plaid?.accessTokenEnc) },
    });
  } catch (err) {
    return errorResponse(err, "status");
  }
}
