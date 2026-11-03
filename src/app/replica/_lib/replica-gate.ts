import { bareStateRedirect, parsePortal } from "@/lib/replica/portal/portals";

/** Static page (inside the replica layout, so both REPLICA banners and the disclaimer render) served with a 404. */
export const REPLICA_NOT_FOUND_PATH = "/replica/unknown-portal";

export type ReplicaGateDecision = { kind: "redirect"; to: string } | { kind: "not-found" } | null;

const REPLICA_PATH = /^\/replica\/([^/]+)(?:\/|$)/;

/**
 * Decides bad replica slugs in the proxy, before routing, so the instant-validated [portal] layout never has to throw
 * notFound() or redirect() for them (that logged "Could not validate instant ... NEXT_HTTP_ERROR_FALLBACK;404" in dev).
 *   - a valid portal slug (`ca-holder`) and the lowercase bare states (route handlers): null.
 *   - a bare state in any other case (`/replica/CA`): redirect to that state's holder portal, like `/replica/ca`.
 *   - anything else under /replica/<slug>, including the 404 page visited directly: not-found (served with a 404).
 * `/replica` itself and non-replica paths: null.
 */
export function replicaGate(pathname: string): ReplicaGateDecision {
  const m = REPLICA_PATH.exec(pathname);
  if (!m?.[1]) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return { kind: "not-found" };
  }
  if (parsePortal(slug)) return null;
  const bare = bareStateRedirect(slug);
  if (bare) return slug === slug.toLowerCase() ? null : { kind: "redirect", to: bare };
  return { kind: "not-found" };
}
