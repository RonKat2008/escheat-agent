/**
 * In-process token bucket for /api/chat, keyed by session. Model calls cost money, so a runaway client (or a
 * stuck retry loop) is capped at a burst of CHAT_BURST turns plus one turn every CHAT_REFILL_MS.
 * Per-instance only: good enough for the single-process demo; a multi-instance deployment should move this
 * to the DB like the login limiter (src/lib/auth/login-limiter.ts).
 */
export const CHAT_BURST = 8;
export const CHAT_REFILL_MS = 7_500;
const MAX_KEYS = 1_000;

export interface ChatLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

const buckets = new Map<string, { tokens: number; at: number }>();

export function consumeChatTurn(key: string, now: number = Date.now()): ChatLimitResult {
  const prev = buckets.get(key) ?? { tokens: CHAT_BURST, at: now };
  const tokens = Math.min(CHAT_BURST, prev.tokens + Math.max(0, now - prev.at) / CHAT_REFILL_MS);
  if (tokens < 1) {
    buckets.set(key, { tokens, at: Math.max(now, prev.at) });
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - tokens) * CHAT_REFILL_MS) / 1000)) };
  }
  if (!buckets.has(key) && buckets.size >= MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  buckets.set(key, { tokens: tokens - 1, at: Math.max(now, prev.at) });
  return { ok: true, retryAfterSec: 0 };
}

/** Tests only. */
export function resetChatLimiter(): void {
  buckets.clear();
}
