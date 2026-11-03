/**
 * Deterministic text metrics for the lifecycle rail: label widths come from character counts times per-glyph advance
 * estimates for Geist / Geist Mono, never from the DOM, so the layout is pure and unit-testable. The estimates lean
 * wide (a label is never narrower on screen than its box), and placement keeps a gap on top of that.
 */

export type LcFamily = "sans" | "mono";

/** Advance widths in em. Geist Mono is a true 0.6em monospace; Geist is bucketed by glyph shape. */
const MONO_EM = 0.6;
const SANS_NARROW = /[ijl|!.,:;'`]/;
const SANS_SEMI = /[ftrI()[\]{}\-/ ]/;
const SANS_WIDE = /[mwMW@%]/;
const SANS_UPPER = /[A-Z]/;
const SANS_DIGIT = /[0-9]/;

function sansEm(ch: string): number {
  if (SANS_NARROW.test(ch)) return 0.28;
  if (SANS_SEMI.test(ch)) return 0.4;
  if (SANS_WIDE.test(ch)) return 0.9;
  if (SANS_UPPER.test(ch)) return 0.72;
  if (SANS_DIGIT.test(ch)) return 0.62;
  return 0.6;
}

/** Estimated rendered width in px of `text` at `fontSize`, with optional letter spacing in em. */
export function textWidth(text: string, fontSize: number, family: LcFamily = "sans", letterSpacingEm = 0): number {
  let em = 0;
  for (const ch of text) em += (family === "mono" ? MONO_EM : sansEm(ch)) + letterSpacingEm;
  return Math.ceil(em * fontSize);
}

/**
 * Greedy word wrap to `maxWidth` px. A single word wider than the limit keeps its own line (never split mid-word);
 * the caller sizes the box from the widest line, so nothing is ever hidden.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, family: LcFamily = "sans"): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || textWidth(next, fontSize, family) <= maxWidth) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "2028-09-01" -> "Sep 1, 2028". The one date format of the rail, its vertical list and its screen-reader table. */
export function formatLifecycleDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}
