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
  return STATIC_PREFIXES.some((s) => p.startsWith(s));
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

/* ------------------------------------------------------------------ M7 hardening */

function hostPatterns(appBaseUrl: string): string[] {
  const u = parse(appBaseUrl);
  const host = u?.hostname ?? "localhost";
  return LOCAL_HOSTS.has(host) || host === "[::1]" ? ["localhost", "127.0.0.1"] : [host];
}

/**
 * Chromium flags that fence the WHOLE browser (every context, service worker, WebSocket, CDP-created context),
 * independent of Playwright's per-context route(): hostnames other than the app resolve to NOTFOUND, and all other
 * traffic (IP literals included) goes to a dead proxy. Loopback and the app host bypass the proxy.
 */
export function fenceChromiumArgs(appBaseUrl: string): string[] {
  const hosts = hostPatterns(appBaseUrl);
  const bypass = [...hosts, ...(hosts.includes("localhost") ? ["[::1]"] : [])];
  return [
    `--host-resolver-rules=MAP * ~NOTFOUND, ${hosts.map((h) => `EXCLUDE ${h}`).join(", ")}`,
    "--proxy-server=http://127.0.0.1:9",
    `--proxy-bypass-list=${bypass.join(";")}`,
  ];
}

/** Structural subsets of Playwright's Page / BrowserContext used by hardenContext. */
export interface WatchablePage {
  on(event: "framenavigated", handler: (frame: { url(): string }) => void): unknown;
  close(): Promise<void>;
}
export interface HardenableContext {
  pages(): WatchablePage[];
  on(event: "page", handler: (page: WatchablePage) => void): unknown;
  routeWebSocket(url: RegExp, handler: (ws: { url(): string; close(): Promise<void>; connectToServer(): unknown }) => void): Promise<void>;
}

function wsToHttp(url: string): string {
  return url.replace(/^ws(s?):/i, "http$1:");
}

/** Frame URLs that are not network destinations (blank pages, Chromium's error page after a blocked request). */
function isInertFrameUrl(url: string): boolean {
  return url === "" || url === "about:blank" || url === "about:srcdoc" || url.startsWith("chrome-error://");
}

/**
 * Beyond route(): drop WebSockets that are not replica-origin, and check EVERY frame navigation on EVERY page
 * (including popups and pages opened later) against the fence. A violation closes the page and calls onViolation,
 * which the caller uses to abort the run.
 */
export async function hardenContext(
  context: HardenableContext,
  appBaseUrl: string,
  opts: { log?: (msg: string) => void; onViolation: (url: string) => void },
): Promise<void> {
  const log = opts.log ?? ((m: string) => console.warn(m));
  await context.routeWebSocket(/.*/, (ws) => {
    const url = ws.url();
    if (isReplicaUrl(wsToHttp(url), appBaseUrl)) {
      ws.connectToServer();
      return;
    }
    log(`[replica-fence] closed websocket ${url}`);
    void ws.close();
  });
  const watch = (page: WatchablePage) => {
    page.on("framenavigated", (frame) => {
      const url = frame.url();
      if (isInertFrameUrl(url) || isAllowedReplicaRequest(url, appBaseUrl)) return;
      log(`[replica-fence] navigation violation ${url}`);
      void page.close().catch(() => undefined);
      opts.onViolation(url);
    });
  };
  for (const p of context.pages()) watch(p);
  context.on("page", watch);
}
