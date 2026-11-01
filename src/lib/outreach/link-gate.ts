import { OwnerTokenConfigError, OwnerTokenError, verifyOwnerToken } from "./tokens";

export interface OwnerLinkRejection {
  /** HTTP status: 410 for an expired (once valid) link, 404 for anything forged or malformed. */
  status: 404 | 410;
  /** Key into the owner page's reason copy. */
  reason: "expired" | "invalid";
}

export const OWNER_LINK_ERROR_PATH = "/owner/link-error";

/**
 * Cheap, DB-free check of an /owner/<token> URL: signature and expiry only. Returns the rejection to serve, or null
 * when the request should continue to the page (not an owner link, a valid signature, or a missing secret, which the
 * page reports itself). Whether the token matches a stored outreach is still checked by the page.
 */
export function rejectOwnerLink(pathname: string, now: Date = new Date(), secret?: string): OwnerLinkRejection | null {
  const m = /^\/owner\/([^/]+)\/?$/.exec(pathname);
  if (!m || m[1] === "link-error") return null;
  let token: string;
  try {
    token = decodeURIComponent(m[1]!);
  } catch {
    return { status: 404, reason: "invalid" };
  }
  try {
    verifyOwnerToken(token, now, secret);
    return null;
  } catch (e) {
    if (e instanceof OwnerTokenConfigError) return null;
    if (e instanceof OwnerTokenError) {
      return e.reason === "expired" ? { status: 410, reason: "expired" } : { status: 404, reason: "invalid" };
    }
    throw e;
  }
}
