/**
 * Base URL for owner links. APP_BASE_URL always wins. Without it (local dev), fall back to the origin the current
 * request was served from, then to http://localhost:$PORT. Never a hardcoded port.
 */
export function baseUrlFrom(opts: { appBaseUrl?: string; requestOrigin?: string | null; port?: string }): string {
  const configured = opts.appBaseUrl?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (opts.requestOrigin) return opts.requestOrigin.replace(/\/+$/, "");
  return `http://localhost:${opts.port?.trim() || "3000"}`;
}

/** Origin of the in-flight request (x-forwarded-* aware), or null outside a request scope. */
export async function currentRequestOrigin(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host || !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return null;
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return /^https?$/.test(proto) ? `${proto}://${host}` : null;
  } catch {
    return null;
  }
}
