/**
 * DESIGN-V3 §1.2 hard rules, enforced over the source tree: black + electric blue + pink only.
 *  1. Tailwind color utilities in any other hue (amber, green, red, ...) are banned everywhere under src/.
 *  2. Raw #hex / rgb() / hsl() literals are banned outside globals.css and src/components/viz/** /palette.ts, on the
 *     shared design system now; page folders join RAW_COLOR_DIRS as their V3 slice lands.
 * (Kept as a test rather than an ESLint rule: the repo's config-protection hook blocks edits to eslint.config.mjs.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BANNED_HUES = "amber|green|red|emerald|sky|indigo|purple|violet|yellow|orange|teal|cyan|lime|rose|fuchsia";
const OFF_PALETTE = new RegExp(
  `(?:^|[\\s:"'\`!])(?:bg|text|border|border-[trblxy]|from|to|via|ring|ring-offset|fill|stroke|outline|shadow|decoration|accent|caret|divide|placeholder)-(?:${BANNED_HUES})-\\d{2,3}\\b`,
);
const RAW_COLOR = /(?:^|[\s[(:,="'])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])|\b(?:rgba?|hsla?)\(/;

const RAW_COLOR_DIRS = [
  "src/components/ui",
  "src/components/primitives",
  "src/components/motion",
  "src/components/shell",
  "src/components/b",
  "src/components/viz",
  "src/lib/ui",
  "src/lib/next-action.ts",
  "src/app/layout.tsx",
  "src/app/(app)/layout.tsx",
  "src/app/not-found.tsx",
  "src/app/error.tsx",
  "src/app/global-error.tsx",
  "src/app/_status",
];

function walk(p: string): string[] {
  const abs = path.join(ROOT, p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return /\.(tsx?|css)$/.test(p) ? [p] : [];
  return readdirSync(abs).flatMap((name) => walk(path.join(p, name)));
}

/** Lines that match, skipping comment-only lines (docs may name the banned hues). */
function offenders(files: string[], re: RegExp): string[] {
  const out: string[] = [];
  for (const f of files) {
    readFileSync(path.join(ROOT, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        // The browser chrome colour (<meta name="theme-color">) cannot reference a CSS variable; it is ink-0 (V4).
        if (f === "src/app/layout.tsx" && /themeColor: "#0B1430"/.test(line)) return;
        if (re.test(line)) out.push(`${f}:${i + 1}: ${t.slice(0, 120)}`);
      });
  }
  return out;
}

describe("V3 palette ban", () => {
  it("no off-palette Tailwind hue utilities anywhere in src/", () => {
    const files = walk("src").filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".css"));
    expect(offenders(files, OFF_PALETTE)).toEqual([]);
  });

  it("no raw color literals in the shared design system (globals.css and viz palette.ts excepted)", () => {
    const files = RAW_COLOR_DIRS.flatMap(walk).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".css") && !/viz\/.*palette\.ts$/.test(f));
    expect(offenders(files, RAW_COLOR)).toEqual([]);
  });

  it("the patterns catch what they should and spare check numbers", () => {
    expect(OFF_PALETTE.test('className="bg-green-500"')).toBe(true);
    expect(OFF_PALETTE.test('className="hover:text-red-400"')).toBe(true);
    expect(OFF_PALETTE.test('className="bg-blue-500 text-pink-400"')).toBe(false);
    expect(RAW_COLOR.test('color: "#1f5bff"')).toBe(true);
    expect(RAW_COLOR.test("bg-[#3369ff]")).toBe(true);
    expect(RAW_COLOR.test("rgb(255 255 255 / 0.1)")).toBe(true);
    expect(RAW_COLOR.test("check #10482")).toBe(false);
    expect(RAW_COLOR.test("#123456789")).toBe(false);
  });
});
