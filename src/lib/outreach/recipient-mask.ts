/**
 * R4-24: allowlisted test recipients can be a person's real inbox or phone, so the full value never reaches the browser.
 * The client gets an opaque ref ("allow:<hash>") plus a masked label ("r•••@gmail.com"); the server resolves the ref
 * back to the full value right before the allowlist check. Pure helpers only (safe to import from client code).
 */

export const RECIPIENT_REF_PREFIX = "allow:";
const DOT = "•";

export interface RecipientOption {
  /** Opaque, stable reference the server can resolve; never the address itself. */
  ref: string;
  /** What the screen shows: first character plus the domain for email, last two digits for a phone. */
  label: string;
}

/** "ronit@gmail.com" -> "r•••@gmail.com". Anything without a usable "@" is masked whole. */
export function maskEmail(value: string): string {
  const v = value.trim();
  const at = v.lastIndexOf("@");
  if (at < 1 || at === v.length - 1) return `${v.slice(0, 1)}${DOT.repeat(3)}`;
  return `${v.slice(0, 1)}${DOT.repeat(3)}${v.slice(at)}`;
}

/** "+14155550100" -> "+1 ••• ••• ••00". Keeps the country code and the last two digits. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return DOT.repeat(4);
  const cc = value.trim().startsWith("+") && digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "";
  return `${cc}${DOT.repeat(3)} ${DOT.repeat(3)} ${DOT.repeat(2)}${digits.slice(-2)}`;
}

export function maskRecipient(channel: "email" | "voice", value: string): string {
  return channel === "email" ? maskEmail(value) : maskPhone(value);
}

export function isRecipientRef(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(RECIPIENT_REF_PREFIX);
}

/** Same normalisation as the server allowlist (allowlist.ts): lower-cased email, E.164 phone (bare 10 digits = US). */
export function normalizeRecipient(channel: "email" | "voice", value: string): string {
  if (channel === "email") return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return value.trim();
}

/** The material a ref hashes; recipient-ref.ts (server) and refForTyped (browser) must agree. */
export function refMaterial(channel: "email" | "voice", value: string): string {
  return `${channel}:${normalizeRecipient(channel, value)}`;
}

export const REF_HEX_LENGTH = 20;

/**
 * Browser-side ref of a typed recipient, so typing an allowlisted address is recognised without the page ever holding
 * the allowlist itself. Null when Web Crypto is unavailable (the server still decides).
 */
export async function refForTyped(channel: "email" | "voice", value: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !value.trim()) return null;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(refMaterial(channel, value)));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${RECIPIENT_REF_PREFIX}${hex.slice(0, REF_HEX_LENGTH)}`;
}
