/**
 * The replica fence logs every request it refuses. Requests for the app's own dev-server plumbing (HMR socket,
 * font and static chunks under /_next) are tooling noise, not agent activity. Real blocks (any other host, or
 * app paths that are not dev assets) are security-relevant and stay visible, in plain words.
 */

const FENCE_LINE_RE = /^\[replica-fence\]\s+(blocked|closed websocket|navigation violation)\s+(\S+)/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEV_PATH_RE = /^\/(?:_next|__nextjs[^/]*|__webpack_hmr|_vercel)(?:\/|$)|^\/favicon\.ico$|\.(?:woff2?|ttf|otf|map)$/i;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True for a URL on the local app origin that is dev-server plumbing (HMR, fonts, static chunks). */
export function isDevAssetUrl(url: string): boolean {
  const u = parse(url);
  if (!u || !LOCAL_HOSTS.has(u.hostname)) return false;
  return DEV_PATH_RE.test(u.pathname);
}

/** True for a raw `[replica-fence] ...` line that only concerns dev-server assets. Navigation violations never count. */
export function isDevFenceNoise(message: string): boolean {
  const m = FENCE_LINE_RE.exec(message.trim());
  if (!m) return false;
  return m[1]!.toLowerCase() !== "navigation violation" && isDevAssetUrl(m[2]!);
}

function hostOf(url: string): string {
  return parse(url)?.host || url;
}

/** Plain-language wording for a raw fence line; non-fence text is returned unchanged. */
export function describeFenceEvent(message: string): string {
  const m = FENCE_LINE_RE.exec(message.trim());
  if (!m) return message;
  const kind = m[1]!.toLowerCase();
  const url = m[2]!;
  if (kind === "closed websocket") return `Blocked a live connection to ${hostOf(url)} (outside the replica sandbox)`;
  if (kind === "navigation violation") return `Stopped navigation to ${url} (outside the replica sandbox)`;
  return `Blocked a request to ${hostOf(url)} (outside the replica sandbox): ${url}`;
}

/** Drops dev-asset fence lines and rewords the rest. For any list of trace/progress messages. */
export function cleanFenceMessages<T extends { message: string }>(steps: readonly T[]): T[] {
  return steps
    .filter((s) => !isDevFenceNoise(s.message))
    .map((s) => (s.message.startsWith("[replica-fence]") ? { ...s, message: describeFenceEvent(s.message) } : s));
}
