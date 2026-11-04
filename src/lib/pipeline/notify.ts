/** Best-effort Inngest sends: the app works without the Inngest dev server, so failures only log. */
import { clockAdvanced, inngest, itemStaleCreated } from "@/inngest/client";

/** Short on purpose: Inngest is optional, so a request must never wait long on it (R5-20). */
const SEND_TIMEOUT_MS = 500;
/** After a failed send the dev server is assumed down for this long, so later calls skip it (detect once). */
const DOWN_FOR_MS = 60_000;
let downUntil = 0;

/** Test hook. */
export function resetInngestDownCache(): void {
  downUntil = 0;
}

async function bestEffort(label: string, send: () => Promise<unknown>): Promise<boolean> {
  if (Date.now() < downUntil) return false;
  try {
    await Promise.race([
      send(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SEND_TIMEOUT_MS).unref?.()),
    ]);
    return true;
  } catch (err) {
    downUntil = Date.now() + DOWN_FOR_MS;
    console.warn(`[inngest] ${label} not sent (dev server not running?): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function notifyClockAdvanced(args: { companyId: string; offsetDays: number; now: string }): Promise<boolean> {
  return bestEffort("clock/advanced", () =>
    inngest.send(clockAdvanced.create({ companyId: args.companyId, offsetDays: args.offsetDays, now: `${args.now}T00:00:00.000Z` })),
  );
}

export function notifyStaleCreated(items: Array<{ staleItemId: string; companyId: string; ownerState: string | null }>): Promise<boolean> {
  if (items.length === 0) return Promise.resolve(true);
  return bestEffort("item/stale.created", () => inngest.send(items.map((i) => itemStaleCreated.create(i))));
}
