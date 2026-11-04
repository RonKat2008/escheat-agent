import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { portalHref, REPLICA_COOKIE, safeReturnTo, verifySessionToken, type Portal, type SessionPayload } from "@/lib/replica/portal";

/** Returns the session when valid for this portal's state, else null. */
export async function getHolderSession(portal: Portal): Promise<SessionPayload | null> {
  await connection(); // session expiry reads the clock: force request-time rendering
  const token = (await cookies()).get(REPLICA_COOKIE)?.value;
  const session = verifySessionToken(token);
  return session && session.st === portal.state ? session : null;
}

/** `returnTo` (a path inside this portal) rides through the sign-in page as `?next=` (R7-11). */
export async function requireHolderSession(portal: Portal, returnTo?: string): Promise<SessionPayload> {
  const session = await getHolderSession(portal);
  if (!session) {
    const next = returnTo ? safeReturnTo(portal.slug, returnTo) : null;
    redirect(next ? `${portalHref(portal)}?next=${encodeURIComponent(next)}` : portalHref(portal));
  }
  return session;
}
