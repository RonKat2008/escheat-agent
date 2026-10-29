import { z } from "zod";
import { DISCLAIMER } from "@/lib/disclaimer";
import { escapeHtml, withPreviewBanner } from "@/lib/letters/template";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { loadOutreach, outreachContentSha256 } from "@/lib/outreach/util";
import { sessionGuard } from "@/lib/auth/session";

const Params = z.object({ id: z.string().uuid() });

/** Renders the stored draft exactly as composed, with an in-app banner that is not part of the mailed content. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const { id } = Params.parse(await ctx.params);
    const row = await loadOutreach(await getOutreachDb(), id);
    const compose = row.tracking?.compose as { readiness?: { ready?: boolean; problems?: string[] }; requiredLanguageVerified?: boolean; variables_source?: string } | undefined;
    const notes = [
      row.offline ? "OFFLINE PREVIEW - nothing was sent" : null,
      compose?.readiness?.ready === false ? `NOT READY: ${(compose.readiness.problems ?? []).join("; ")}` : null,
      row.channel === "letter" && compose?.requiredLanguageVerified === false ? "UNVERIFIED rule text" : null,
      compose?.variables_source ? `variables_source: ${compose.variables_source}` : null,
      DISCLAIMER,
    ].filter(Boolean);
    const inner =
      row.body === null
        ? "<p>No draft composed yet.</p>"
        : row.channel === "voice"
          ? `<pre style="white-space:pre-wrap;font:14px/1.5 system-ui;padding:16px">${escapeHtml(row.body)}</pre>`
          : row.body;
    const html = withPreviewBanner(
      /<html/i.test(inner) ? inner : `<!doctype html><html><body>${inner}</body></html>`,
      `Preview (${row.channel}, ${row.status}). ${notes.join(" | ")}`,
    );
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        // Stored HTML is escaped, but the preview should never run scripts or load remote content.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
        "cache-control": "no-store",
        /** What a reviewer is looking at; approve must send it back as expectedContentSha256 (M2). */
        "x-content-sha256": outreachContentSha256(row),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
