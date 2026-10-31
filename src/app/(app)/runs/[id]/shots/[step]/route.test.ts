import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ root: "", trace: [] as unknown[] }));

vi.mock("@/lib/auth/session", () => ({ sessionGuard: async () => null }));
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/queries", () => ({ getAgentRun: async () => ({ trace: state.trace }) }));
vi.mock("@/lib/browser-agents/recorder", () => ({
  get ARTIFACTS_ROOT() {
    return state.root;
  },
}));

import { GET } from "./route";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
let base: string;
let runDir: string;

const get = (step = 0) => GET(new Request("http://x/shots"), { params: Promise.resolve({ id: RUN_ID, step: String(step) }) });

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "shots-"));
  state.root = path.join(base, "artifacts");
  runDir = path.join(state.root, RUN_ID);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "ok.png"), PNG);
  writeFileSync(path.join(base, "secret.png"), "TOP SECRET");
  symlinkSync(path.join(base, "secret.png"), path.join(runDir, "link.png")); // file symlink escaping the run folder
  symlinkSync(base, path.join(runDir, "linkdir")); // directory symlink escaping the run folder
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("GET /runs/[id]/shots/[step]", () => {
  it("serves a real png inside the run folder with private, no-store caching", async () => {
    state.trace = [{ screenshot: path.join(runDir, "ok.png") }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("refuses a symlink that points outside the run folder", async () => {
    state.trace = [{ screenshot: path.join(runDir, "link.png") }];
    expect((await get()).status).toBe(404);
  });

  it("refuses a path through a symlinked directory that escapes the run folder", async () => {
    state.trace = [{ screenshot: path.join(runDir, "linkdir", "secret.png") }];
    expect((await get()).status).toBe(404);
  });

  it("refuses ../ traversal, other run folders, and non-png files", async () => {
    state.trace = [{ screenshot: path.join(runDir, "..", "..", "secret.png") }];
    expect((await get()).status).toBe(404);
    state.trace = [{ screenshot: path.join(runDir, "ok.txt") }];
    expect((await get()).status).toBe(404);
  });

  it("404s a missing file and a missing step", async () => {
    state.trace = [{ screenshot: path.join(runDir, "nope.png") }];
    expect((await get()).status).toBe(404);
    expect((await get(5)).status).toBe(404);
  });
});
