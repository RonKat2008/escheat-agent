import { timingSafeEqual } from "@/lib/crypto";

export type McpAuthResult = { ok: true } | { ok: false; status: 401 | 403 | 503; message: string };

/**
 * Bearer-token check for the HTTP endpoint. MCP_TOKEN is REQUIRED in every environment, development included
 * (security review L1): an unauthenticated localhost endpoint is reachable from any web page the developer visits.
 */
export function checkMcpAuth(authorization: string | null, env: Record<string, string | undefined> = process.env): McpAuthResult {
  const token = env.MCP_TOKEN?.trim();
  if (!token) return { ok: false, status: 503, message: "MCP_TOKEN not configured" };
  const m = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!m || !timingSafeEqual(m[1]!, token)) return { ok: false, status: 401, message: "Unauthorized" };
  return { ok: true };
}

type McpEnv = Record<string, string | undefined>;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts this deployment answers to (host[:port]). Loopback names are allowed outside production. */
export function allowedMcpHosts(env: McpEnv = process.env): string[] {
  const out = new Set<string>();
  for (const v of [env.APP_BASE_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL, ...(env.MCP_ALLOWED_HOSTS?.split(",") ?? [])]) {
    const h = hostOf(v?.trim());
    if (h) out.add(h);
  }
  if (env.NODE_ENV !== "production") {
    for (const l of LOOPBACK_HOSTS) out.add(l);
    // loopback with any port
    const base = hostOf(env.APP_BASE_URL);
    if (base) out.add(base);
  }
  return [...out];
}

function hostAllowed(host: string, allowed: string[], env: McpEnv): boolean {
  const bare = host.replace(/:\d+$/, "");
  return allowed.some((a) => a === host || a.replace(/:\d+$/, "") === host) || (env.NODE_ENV !== "production" && LOOPBACK_HOSTS.includes(bare));
}

/**
 * DNS-rebinding / cross-origin protection (L1): the Host header must be one of ours, and a browser Origin (which MCP
 * CLIs/servers never send) must be one of ours too. Combined with the bearer token this closes the "malicious web
 * page talks to my local MCP server" path.
 */
export function checkMcpOrigin(headers: Pick<Headers, "get">, requestUrl: string, env: McpEnv = process.env): McpAuthResult {
  const allowed = allowedMcpHosts(env);
  if (allowed.length === 0) return { ok: true }; // unknown deployment host: the bearer token is the only control
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? new URL(requestUrl).host).toLowerCase();
  if (!hostAllowed(host, allowed, env)) return { ok: false, status: 403, message: "Host not allowed" };
  const origin = headers.get("origin");
  if (origin !== null) {
    const oh = hostOf(origin);
    if (!oh || !hostAllowed(oh, allowed, env)) return { ok: false, status: 403, message: "Origin not allowed" };
  }
  return { ok: true };
}
