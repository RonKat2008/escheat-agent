/** Banner note on a preview whose owner link is not live yet (R4-10). */
export const OWNER_LINK_PENDING_NOTE = "The owner link in this preview is not active: it starts working only after this notice is approved and sent.";

const INERT_STYLE =
  "<style>[data-owner-link-pending]{pointer-events:none;cursor:default;color:#5b6683;text-decoration:line-through}.owner-link-pending-note{font-style:italic;color:#4a5470}</style>";
const PENDING_NOTE_HTML = ' <span class="owner-link-pending-note">(not active until this notice is approved and sent)</span>';
const OWNER_URL = /(https?:\/\/[^\s<>"']*\/owner\/[A-Za-z0-9_.~%-]+)/g;

/**
 * Marks every /owner/<token> link in an internal preview as pending: anchors become non-clickable, and a printed URL is
 * struck through with a plain note. The URL itself stays as composed (the reviewer approves exact content); the server
 * gate (isOwnerLinkLive) is what actually refuses the token until the notice is sent.
 */
export function inertOwnerLinks(html: string): string {
  let touched = false;
  // Anchors: keep the href, make them inert.
  let out = html.replace(/<a\b([^>]*\bhref=(["'])[^"']*\/owner\/[^"']*\2[^>]*)>/gi, (_m, attrs: string) => {
    touched = true;
    return `<a${attrs} data-owner-link-pending="true" aria-disabled="true" tabindex="-1">`;
  });
  // Printed URLs in text nodes (never inside tags or attributes).
  out = out.replace(/>([^<]+)</g, (whole, text: string) => {
    const marked = text.replace(OWNER_URL, (url) => `<span data-owner-link-pending="true">${url}</span>${PENDING_NOTE_HTML}`);
    if (marked === text) return whole;
    touched = true;
    return `>${marked}<`;
  });
  if (!touched) return html;
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}${INERT_STYLE}`) : `${INERT_STYLE}${out}`;
}
