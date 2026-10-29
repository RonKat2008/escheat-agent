import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. REPL-CA-2026-K7QX2M. Prefix distinguishes filings ("REPL") from claims ("REPL-CLM"). */
export function makeConfirmationNumber(
  stateCode: string,
  kind: "filing" | "claim" = "filing",
  year: number = new Date().getUTCFullYear(),
): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  const prefix = kind === "claim" ? "REPL-CLM" : "REPL";
  return `${prefix}-${stateCode.toUpperCase()}-${year}-${suffix}`;
}
