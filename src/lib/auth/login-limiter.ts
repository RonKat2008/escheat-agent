import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginAttempts } from "@/db/schema";

/**
 * Per-key token bucket for login attempts, stored in the DB so it survives restarts and is shared by every
 * instance. Burst of 5, one token refilled per 12s (5/min sustained).
 */
export const LOGIN_BURST = 5;
export const LOGIN_REFILL_MS = 12_000;

export interface LoginAttemptResult {
  ok: boolean;
  retryAfterSec: number;
}

/** Pure bucket step: refill by elapsed time, then spend one token if available. */
export function stepBucket(
  bucket: { tokens: number; at: number },
  now: number,
): { tokens: number; result: LoginAttemptResult } {
  const tokens = Math.min(LOGIN_BURST, bucket.tokens + Math.max(0, now - bucket.at) / LOGIN_REFILL_MS);
  if (tokens < 1) {
    return {
      tokens,
      result: { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - tokens) * LOGIN_REFILL_MS) / 1000)) },
    };
  }
  return { tokens: tokens - 1, result: { ok: true, retryAfterSec: 0 } };
}

export async function consumeLoginAttempt(db: Db, key: string, now: number = Date.now()): Promise<LoginAttemptResult> {
  return db.transaction(async (tx) => {
    // Ensure the row exists, then lock it so concurrent attempts on the same key serialize.
    await tx
      .insert(loginAttempts)
      .values({ key, tokens: LOGIN_BURST, updatedAtMs: now })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.key, key))
      .for("update");
    const { tokens, result } = stepBucket({ tokens: row!.tokens, at: row!.updatedAtMs }, now);
    await tx.update(loginAttempts).set({ tokens, updatedAtMs: Math.max(now, row!.updatedAtMs) }).where(eq(loginAttempts.key, key));
    // Opportunistic cleanup: buckets idle long enough to be full again carry no information.
    await tx.delete(loginAttempts).where(sql`${loginAttempts.updatedAtMs} < ${now - LOGIN_BURST * LOGIN_REFILL_MS * 10}`);
    return result;
  });
}

/** Test/ops helper: forget all attempts. */
export async function resetLoginLimiter(db: Db): Promise<void> {
  await db.delete(loginAttempts);
}
