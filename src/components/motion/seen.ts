/**
 * Pure helpers for "first view this session" bookkeeping. The list is a comma-separated set of short ids, kept in a
 * session cookie (server can read it, so first-visit animations are decided at render time with no flicker) or in
 * sessionStorage (count-ups).
 */
export const SEEN_COOKIE = "es_seen";
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_IDS = 24;

export function isValidSeenId(id: string): boolean {
  return ID_RE.test(id);
}

/** Parse a stored list. Unknown or malformed entries are dropped, never thrown. */
export function parseSeen(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    /* keep the raw text */
  }
  return [...new Set(text.split(",").map((s) => s.trim()).filter(isValidSeenId))].slice(-MAX_IDS);
}

export function hasSeen(raw: string | null | undefined, id: string): boolean {
  return parseSeen(raw).includes(id);
}

/** New list with `id` appended (no duplicates, bounded length). Invalid ids leave the list unchanged. */
export function addSeen(raw: string | null | undefined, id: string): string {
  const list = parseSeen(raw);
  if (!isValidSeenId(id) || list.includes(id)) return list.join(",");
  return [...list, id].slice(-MAX_IDS).join(",");
}

/** Session cookie string (no Max-Age, so it ends with the browser session). */
export function seenCookie(raw: string | null | undefined, id: string): string {
  return `${SEEN_COOKIE}=${encodeURIComponent(addSeen(raw, id))}; Path=/; SameSite=Lax`;
}

/** Read one cookie value out of a document.cookie string. */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
