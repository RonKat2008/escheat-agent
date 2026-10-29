import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { portalHref, REPLICA_COOKIE, verifySessionToken, type Portal, type SessionPayload } from "@/lib/replica/portal";

/** Returns the session when valid for this portal's state, else null. */
export async function getHolderSession(portal: Portal): Promise<SessionPayload | null> {
  await connection(); // session expiry reads the clock: force request-time rendering
  const token = (await cookies()).get(REPLICA_COOKIE)?.value;
  const session = verifySessionToken(token);
  return session && session.st === portal.state ? session : null;
}

export async function requireHolderSession(portal: Portal): Promise<SessionPayload> {
  const session = await getHolderSession(portal);
  if (!session) redirect(portalHref(portal));
  return session;
}
