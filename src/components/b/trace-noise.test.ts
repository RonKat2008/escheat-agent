import { describe, expect, it } from "vitest";
import { foldDevNoise, isDevNoise } from "./trace-noise";
import { normalizeTrace } from "./trace";

const hmr = (n: number) => ({ at: `2026-11-01T10:00:0${n}Z`, kind: "guard_blocked", message: "Guard blocked [replica-fence] closed websocket ws://localhost:3111/_next/hmr?id=abc" });

describe("foldDevNoise", () => {
  it("recognises only dev-server websocket blocks as noise", () => {
    expect(isDevNoise({ kind: "guard_blocked", label: hmr(1).message })).toBe(true);
    expect(isDevNoise({ kind: "guard_blocked", label: "Guard blocked [replica-fence] navigation to https://example.com/" })).toBe(false);
    expect(isDevNoise({ kind: "action", label: "ws://localhost:3111/_next/hmr" })).toBe(false);
  });

  it("folds HMR blocks into one row and keeps real steps and real blocks, with original indices", () => {
    const steps = normalizeTrace(
      [
        { at: "2026-11-01T10:00:00Z", kind: "info", message: "start" },
        hmr(1),
        hmr(2),
        { at: "2026-11-01T10:00:03Z", kind: "guard_blocked", message: "Guard blocked [replica-fence] request to https://evil.example/" },
        hmr(4),
        { at: "2026-11-01T10:00:05Z", kind: "done", message: "done" },
      ],
      null,
    );
    const out = foldDevNoise(steps);
    expect(out.map((s) => s.kind)).toEqual(["info", "dev_noise", "guard_blocked", "done"]);
    expect(out[1]!.label).toBe("3 dev-server (HMR) websocket connections blocked by the guard");
    expect(out[1]!.index).toBe(1);
    expect(out[3]!.index).toBe(5);
  });

  it("returns the input untouched when there is no noise", () => {
    const steps = normalizeTrace([{ kind: "info", message: "a" }], null);
    expect(foldDevNoise(steps)).toEqual(steps);
  });
});
