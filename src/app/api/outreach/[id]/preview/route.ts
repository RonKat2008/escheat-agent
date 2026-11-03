import { z } from "zod";
import { DISCLAIMER } from "@/lib/disclaimer";
import { escapeHtml, withPreviewBanner } from "@/lib/letters/template";
import { previewNotes, type ComposeRecord } from "@/lib/letters/preview-notes";
import { getOutreachDb } from "@/lib/outreach/db";
import { errorResponse } from "@/lib/outreach/http";
import { loadOutreach, outreachContentSha256 } from "@/lib/outreach/util";
import { sessionGuard } from "@/lib/auth/session";
import { inertOwnerLinks, OWNER_LINK_PENDING_NOTE } from "@/lib/outreach/owner-link-preview";
import { isOwnerLinkLive } from "@/lib/outreach/tokens";

const Params = z.object({ id: z.string().uuid() });

/** Renders the stored draft exactly as composed, with an in-app banner that is not part of the mailed content. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const { id } = Params.parse(await ctx.params);
    const row = await loadOutreach(await getOutreachDb(), id);
    const compose = row.tracking?.compose as ComposeRecord | undefined;
    const { notes: found, built } = previewNotes({ channel: row.channel, offline: Boolean(row.offline), compose });
    // R4-10: an owner link in a letter that has not been approved and sent is shown, but it is inert and the server refuses it.
    const live = isOwnerLinkLive(row);
    const notes = [...found, ...(live ? [] : [OWNER_LINK_PENDING_NOTE]), DISCLAIMER];
    const inner =
      row.body === null
        ? "<p>No draft composed yet.</p>"
        : row.channel === "voice"
          ? `<pre style="white-space:pre-wrap;font:14px/1.5 system-ui;padding:16px">${escapeHtml(row.body)}</pre>`
          : live
            ? row.body
            : inertOwnerLinks(row.body);
    const html = withPreviewBanner(
      /<html/i.test(inner) ? inner : `<!doctype html><html><body>${inner}</body></html>`,
      `Preview (${row.channel}, ${row.status}). ${notes.join(" | ")}`,
      built,
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
