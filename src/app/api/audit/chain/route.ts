import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { GENESIS_HASH, verifyRows } from "@/lib/audit/chain";
import { loadChain } from "@/lib/audit/chain-db";
import { sessionGuard } from "@/lib/auth/session";
import { resolveCompanyId } from "@/lib/pipeline/company";

/** How to re-check the file without this app; shipped inside the download. */
const CHAIN_METHOD =
  "Each row's hash is sha256 (hex) of the canonical JSON (object keys sorted, no whitespace) of " +
  '{"seq","prevHash","occurredAt","kind","subject":{"type","id"},"payload"} where payload is the parsed payload text. ' +
  `Row 1's prevHash is ${GENESIS_HASH}; each later row's prevHash is the previous row's hash.`;

/**
 * GET /api/audit/chain: the company's whole audit chain as JSON (download), with the verification computed from the
 * same rows. Read-only. Behind the passcode session like every API route.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const companyId = await resolveCompanyId(db);
    if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo.", code: "no_company" }, { status: 404 });
    const rows = await loadChain(db, companyId);
    const verification = verifyRows(rows);
    const body = {
      companyId,
      exportedAt: new Date().toISOString(),
      method: CHAIN_METHOD,
      verification,
      rows: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="audit-chain-${verification.headHash.slice(0, 12)}.json"`,
        "cache-control": "no-store",
        "x-audit-chain-head": verification.headHash,
      },
    });
  } catch (err) {
    console.error("[api] audit chain export failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
