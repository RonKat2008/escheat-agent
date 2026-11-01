"use server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { revalidateRunSurfaces } from "@/lib/ui/revalidate";

/**
 * Called by the browser when a background agent run settles (the run finishes outside any request, so nothing on
 * the server can revalidate at that moment). Drops the cached renders of every page that shows run results.
 */
export async function refreshAfterRunAction(): Promise<{ ok: boolean }> {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false };
    throw e;
  }
  revalidateRunSurfaces();
  return { ok: true };
}
