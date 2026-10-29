/**
 * HARD RULE 3: filing/recovery agents may only touch replica portals under
 * `<APP_BASE_URL>/replica/*`. Anything else throws NonReplicaUrlError.
 */

export class NonReplicaUrlError extends Error {
  constructor(
    public readonly url: string,
    public readonly why: string,
  ) {
    super(`Refusing non-replica URL (${why}): ${url}`);
    this.name = "NonReplicaUrlError";
  }
}

export const REPLICA_PREFIX = "/replica/";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SUSPICIOUS_ENCODING = /%(2e|2f|5c|00)/i;
const STATIC_PREFIXES = ["/_next/static/", "/fonts/"];
const STATIC_EXACT = new Set(["/favicon.ico", "/_next/image"]);
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function sameOrigin(u: URL, base: URL): boolean {
  if (u.origin === base.origin) return true;
  // dev convenience: localhost <-> 127.0.0.1 on the SAME port and protocol
  return (
    LOCAL_HOSTS.has(u.hostname) &&
    LOCAL_HOSTS.has(base.hostname) &&
    u.protocol === base.protocol &&
    u.port === base.port
  );
}

/** Returns a rejection reason, or null if the URL is same-origin http(s) without tricks. */
function originProblem(raw: string, appBaseUrl: string): { url?: URL; why?: string } {
  const base = parse(appBaseUrl);
  if (!base || (base.protocol !== "http:" && base.protocol !== "https:")) {
    return { why: "invalid APP_BASE_URL" };
  }
  const u = parse(raw);
  if (!u) return { why: "unparseable" };
  if (u.protocol !== "http:" && u.protocol !== "https:") return { why: `protocol ${u.protocol}` };
  if (u.username || u.password) return { why: "userinfo" };
  if (!sameOrigin(u, base)) return { why: "foreign origin" };
  if (SUSPICIOUS_ENCODING.test(u.pathname) || u.pathname.includes("\\")) {
    return { why: "encoded traversal or separators" };
  }
  if (u.pathname.split("/").some((seg) => seg === "..")) return { why: "traversal" };
  return { url: u };
}

function isReplicaPath(pathname: string): boolean {
  return pathname.startsWith(REPLICA_PREFIX);
}

export function assertReplicaUrl(url: string, appBaseUrl: string): URL {
  const { url: u, why } = originProblem(url, appBaseUrl);
  if (!u) throw new NonReplicaUrlError(url, why ?? "rejected");
  if (!isReplicaPath(u.pathname)) throw new NonReplicaUrlError(url, "path outside /replica/");
  return u;
}

export function isReplicaUrl(url: string, appBaseUrl: string): boolean {
  try {
    assertReplicaUrl(url, appBaseUrl);
    return true;
  } catch {
    return false;
  }
}

/** Network fence: same-origin /replica/* plus the static assets needed to render. Nothing else. */
export function isAllowedReplicaRequest(url: string, appBaseUrl: string): boolean {
  const { url: u } = originProblem(url, appBaseUrl);
  if (!u) return false;
  const p = u.pathname;
  if (isReplicaPath(p)) return true;
  if (STATIC_EXACT.has(p)) return true;
  if (STATIC_PREFIXES.some((s) => p.startsWith(s))) return true;
  return FONT_EXT.test(p);
}

/** Structural subset of Playwright's BrowserContext/Page route API. */
export interface RoutableContext {
  route(
    url: string | RegExp,
    handler: (route: {
      request(): { url(): string };
      continue(): Promise<void>;
      abort(errorCode?: string): Promise<void>;
    }) => Promise<void> | void,
  ): Promise<void>;
}

export async function fencePlaywrightContext(
  context: RoutableContext,
  appBaseUrl: string,
  log: (msg: string) => void = (m) => console.warn(m),
): Promise<{ blocked: string[] }> {
  const blocked: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAllowedReplicaRequest(url, appBaseUrl)) {
      await route.continue();
      return;
    }
    blocked.push(url);
    log(`[replica-fence] blocked ${url}`);
    await route.abort("blockedbyclient");
  });
  return { blocked };
}
