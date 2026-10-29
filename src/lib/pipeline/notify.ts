/** Best-effort Inngest sends: the app works without the Inngest dev server, so failures only log. */
import { clockAdvanced, inngest, itemStaleCreated } from "@/inngest/client";

const SEND_TIMEOUT_MS = 2000;

async function bestEffort(label: string, send: () => Promise<unknown>): Promise<boolean> {
  try {
    await Promise.race([
      send(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SEND_TIMEOUT_MS).unref?.()),
    ]);
    return true;
  } catch (err) {
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
