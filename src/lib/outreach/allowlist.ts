import { allowedRecipients, getEnv, type Env } from "@/lib/env";

/** HARD RULE 4: emails/calls only to allowlisted test targets; Lob test keys only. */

export class RecipientNotAllowedError extends Error {
  constructor(
    public readonly kind: "email" | "phone",
    public readonly target: string,
  ) {
    super(`${kind} recipient "${target}" is not on the test allowlist; refusing to send.`);
    this.name = "RecipientNotAllowedError";
  }
}

export class LiveLobKeyError extends Error {
  constructor() {
    super("Refusing to use a Lob key that is not a test key (must start with 'test_').");
    this.name = "LiveLobKeyError";
  }
}

export const LOB_TEST_PREFIX = "test_";

/** Case-insensitive exact match after trim. Plus-addressing is NOT auto-allowed. Empty list blocks all. */
export function assertAllowedEmail(addr: string, env?: Env): string {
  const norm = (addr ?? "").trim().toLowerCase();
  const list = allowedRecipients(env);
  if (!norm || /[\s,;<>]/.test(norm) || !list.includes(norm)) {
    throw new RecipientNotAllowedError("email", addr);
  }
  return norm;
}

/** Normalize to E.164: strips formatting; bare 10-digit numbers are treated as US (+1). */
export function normalizePhone(num: string): string | null {
  const digits = (num ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function assertAllowedPhone(num: string, env?: Env): string {
  const norm = normalizePhone(num);
  // Split on , ; newline only: formatted numbers like "+1 (415) 555-0100" contain spaces.
  const list = (env ?? getEnv()).ALLOWED_TEST_PHONES?.split(/[,;\n]+/)
    .map(normalizePhone)
    .filter((p): p is string => p !== null) ?? [];
  if (!norm || !list.includes(norm)) throw new RecipientNotAllowedError("phone", num);
  return norm;
}

export function assertLobTestKey(key: string | undefined | null): string {
  if (!key || !key.startsWith(LOB_TEST_PREFIX) || key.length <= LOB_TEST_PREFIX.length) {
    throw new LiveLobKeyError();
  }
  return key;
}
