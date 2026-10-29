import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for security review M6: every mutating route handler and server action must call the session
 * helpers itself (defense in depth behind src/proxy.ts), except surfaces that authenticate by token/signature.
 */
const ROOT = path.resolve(process.cwd(), "src");
const SELF_AUTHENTICATED_ROUTES = ["api/webhooks/", "api/inngest/", "api/mcp/"];
const PUBLIC_ACTION_FILES = ["app/owner/actions.ts", "app/replica/actions.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const usesGuard = (s: string) => /sessionGuard\(|requireSession\(/.test(s);

describe("session guards (M6)", () => {
  const files = walk(ROOT);

  it("every API route handler checks the session", () => {
    const routes = files.filter((f) => /\/api\/.*\/route\.ts$/.test(f.split(path.sep).join("/")));
    expect(routes.length).toBeGreaterThan(10);
    const missing = routes
      .filter((f) => !SELF_AUTHENTICATED_ROUTES.some((p) => rel(f).includes(p)) && !rel(f).endsWith(".test.ts"))
      .filter((f) => !usesGuard(readFileSync(f, "utf8")))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("every server action module checks the session (except the token-authenticated public ones and login)", () => {
    const actions = files.filter((f) => !f.endsWith(".test.ts") && /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
    expect(actions.length).toBeGreaterThanOrEqual(4);
    const missing = actions
      .filter((f) => !PUBLIC_ACTION_FILES.includes(rel(f)) && rel(f) !== "app/login/actions.ts")
      .filter((f) => !usesGuard(readFileSync(f, "utf8")))
      .map(rel);
    expect(missing).toEqual([]);
  });
});
