import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type Outreach } from "@/db/schema";
import { DISCLAIMER } from "@/lib/disclaimer";
import { getEnv } from "@/lib/env";
import { formatUSD } from "@/lib/money";
import { composeLetter, ensureDraftRow, mintOwnerUrl, resolveVariables, type ComposeDeps, type Readiness } from "@/lib/letters/compose";
import { loadItemContext, PROPERTY_LABEL } from "@/lib/letters/context";
import { escapeHtml } from "@/lib/letters/template";
import { mergeTracking } from "./util";

export interface DraftResult {
  outreachId: string;
  channel: Outreach["channel"];
  readiness: Readiness;
  variablesSource: "model" | "template";
}

async function composeEmail(db: Db, staleItemId: string, deps: ComposeDeps): Promise<DraftResult> {
  const env = deps.env ?? getEnv();
  const ctx = await loadItemContext(db, staleItemId);
  const row = await ensureDraftRow(db, ctx, "email");
  const minted = mintOwnerUrl(row.id, env, deps.nowDate ?? new Date());
  const problems = "error" in minted ? [`owner response link unavailable: ${minted.error}`] : [];
  const { variables, source, fallbackReason } = await resolveVariables(ctx, deps, db);
  const url = "error" in minted ? "[owner link unavailable]" : minted.url;
  const html = `<!doctype html><html lang="en"><body style="font-family:system-ui,sans-serif;max-width:560px">
<p>${escapeHtml(variables.greeting)}</p>
<p>${escapeHtml(variables.itemDescription)}</p>
<p><a href="${escapeHtml(url)}">Respond online</a> to confirm your address or tell us the item was already paid:<br>${escapeHtml(url)}</p>
<p style="font-size:12px;color:#555">SYNTHETIC TEST EMAIL. ${escapeHtml(DISCLAIMER)}</p>
</body></html>`;
  const readiness: Readiness = { ready: problems.length === 0, problems, warnings: [] };
  await db
    .update(outreach)
    .set({
      body: html,
      subject: `Action needed: unclaimed payment from ${ctx.company.name}`.slice(0, 200),
      tokenHash: "error" in minted ? null : minted.tokenHash,
      status: "draft",
      tracking: mergeTracking(row.tracking, {
        compose: { variables_source: source, variablesFallbackReason: fallbackReason ?? null, readiness },
      }),
    })
    .where(eq(outreach.id, row.id));
  return { outreachId: row.id, channel: "email", readiness, variablesSource: source };
}

async function composeCallScript(db: Db, staleItemId: string): Promise<DraftResult> {
  const ctx = await loadItemContext(db, staleItemId);
  const row = await ensureDraftRow(db, ctx, "voice");
  const label = PROPERTY_LABEL[ctx.ledger.propertyType] ?? "payment";
  const script =
    `SIMULATED CALL (test). Hello, may I speak with ${ctx.ownerName}? This is an automated assistant calling for ${ctx.company.name}. ` +
    `We are holding a ${label}${ctx.ledger.referenceNumber ? ` number ${ctx.ledger.referenceNumber}` : ""} for ${formatUSD(ctx.stale.amountCents)} ` +
    `that has not been cashed. Could you confirm your current mailing address, or tell us if it was already paid? ` +
    `Do not give legal advice or make claims about what any state will do.`;
  const readiness: Readiness = { ready: true, problems: [], warnings: [] };
  await db
    .update(outreach)
    .set({
      body: script,
      subject: "Simulated call",
      status: "draft",
      tracking: mergeTracking(row.tracking, {
        simulated: true,
        compose: {
          variables_source: "template",
          readiness,
          dynamicVariables: {
            owner_name: ctx.ownerName,
            holder_name: ctx.company.name,
            amount: formatUSD(ctx.stale.amountCents),
            reference_number: ctx.ledger.referenceNumber ?? "",
          },
        },
      }),
    })
    .where(eq(outreach.id, row.id));
  return { outreachId: row.id, channel: "voice", readiness, variablesSource: "template" };
}

/** Compose (and persist as draft) the outreach for any channel. */
export async function draftOutreach(
  db: Db,
  staleItemId: string,
  channel: Outreach["channel"],
  deps: ComposeDeps = {},
): Promise<DraftResult> {
  if (channel === "letter") {
    const r = await composeLetter(db, staleItemId, deps);
    return { outreachId: r.outreachId, channel, readiness: r.readiness, variablesSource: r.variablesSource };
  }
  return channel === "email" ? composeEmail(db, staleItemId, deps) : composeCallScript(db, staleItemId);
}
