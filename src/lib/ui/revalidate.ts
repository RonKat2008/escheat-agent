import { revalidatePath } from "next/cache";

/** Pages that render report, recovery or agent-run state. Cache Components must not keep serving their pre-write render. */
export const RUN_SURFACES = ["/reports", "/recoveries", "/runs", "/dashboard", "/approvals"] as const;

/** Safe to call from route handlers and server actions; a no-op outside a Next request scope (unit tests). */
export function revalidateRunSurfaces(): void {
  try {
    for (const p of RUN_SURFACES) revalidatePath(p);
  } catch {
    // outside a Next request scope: nothing to revalidate
  }
}
