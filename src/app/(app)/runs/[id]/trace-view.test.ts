import { describe, expect, it } from "vitest";
import type { TraceStepView } from "@/components/b/trace";
import { cleanTrace, isDevStep, runVideo, stepSpans } from "./trace-view";

const step = (index: number, kind: string, label: string, extra: Partial<TraceStepView> = {}): TraceStepView => ({
  index,
  kind,
  label,
  at: null,
  durationMs: null,
  data: null,
  screenshot: null,
  tone: "neutral",
  ...extra,
});

describe("cleanTrace", () => {
  it("hides HMR sockets, dev fonts and folded dev-noise rows, keeps real work and real blocks", () => {
    const steps = [
      step(0, "navigate", "Open the replica portal"),
      step(1, "guard_blocked", "Blocked ws://localhost:3490/_next/hmr?id=abc"),
      step(2, "guard_blocked", "Blocked a request", { data: { raw: "[replica-fence] blocked http://localhost:3490/__nextjs_font/geist-latin.woff2" } }),
      step(3, "dev_noise", "26 dev-server (HMR) websocket connections blocked by the guard"),
      step(4, "guard_blocked", "[replica-fence] blocked https://evil.example.com/x.js"),
      step(5, "done", "Submitted"),
    ];
    const { steps: out, hidden } = cleanTrace(steps);
    expect(hidden).toBe(3);
    expect(out.map((s) => s.index)).toEqual([0, 4, 5]);
    expect(out[1]!.label).toBe("Blocked a request to evil.example.com (outside the replica sandbox): https://evil.example.com/x.js");
  });

  it("never hides a navigation violation", () => {
    expect(isDevStep(step(0, "guard_blocked", "[replica-fence] navigation violation http://localhost:3000/_next/x"))).toBe(false);
  });
});

describe("stepSpans", () => {
  const start = Date.parse("2026-11-01T00:00:00Z");
  it("places each timed step on the run's shared axis", () => {
    const steps = [
      step(0, "navigate", "a", { at: "2026-11-01T00:00:00Z", durationMs: 2000 }),
      step(1, "action", "b", { at: "2026-11-01T00:00:02Z", durationMs: 8000 }),
      step(2, "info", "untimed"),
    ];
    const spans = stepSpans(steps, start, start + 10_000);
    expect(spans.get(0)).toEqual({ left: 0, width: 0.2 });
    expect(spans.get(1)).toEqual({ left: 0.2, width: 0.8 });
    expect(spans.has(2)).toBe(false);
  });

  it("is empty when the run has no length", () => {
    expect(stepSpans([step(0, "a", "a", { at: "2026-11-01T00:00:00Z" })], start, start).size).toBe(0);
  });
});

describe("runVideo", () => {
  it("only accepts a recorded .webm path", () => {
    expect(runVideo({ video: "/x/run/video.webm" })).toBe("/x/run/video.webm");
    expect(runVideo({ video: "/etc/passwd" })).toBeNull();
    expect(runVideo(null)).toBeNull();
  });
});

describe("R8-20 prefetch blocks are grouped honestly, real blocks stay", () => {
  const raw = (u: string) => ({ data: { raw: `[replica-fence] blocked ${u}` } });
  it("folds legacy guard_blocked prefetches into one expected row and keeps real blocks", () => {
    const { steps, hidden } = cleanTrace([
      step(0, "guard_blocked", "x", raw("http://localhost:3970/dashboard?_rsc=a")),
      step(1, "info", "Signed in"),
      step(2, "guard_blocked", "x", raw("http://localhost:3970/runs?_rsc=b")),
      step(3, "guard_blocked", "[replica-fence] blocked https://evil.example.com/x.js"),
      step(4, "guard_blocked", "[replica-fence] navigation violation http://localhost:3970/dashboard?_rsc=c"),
    ]);
    const folded = steps.filter((s) => s.kind === "fence_prefetch");
    expect(folded).toHaveLength(1);
    expect(folded[0]!.label).toBe("2 link prefetches blocked by replica fence (expected)");
    expect(steps.filter((s) => s.kind === "guard_blocked")).toHaveLength(2);
    expect(hidden).toBe(0);
  });
  it("also folds new info-step prefetch records", () => {
    const { steps } = cleanTrace([step(0, "info", "Prefetch blocked by replica fence (expected): /runs", raw("http://localhost:3970/runs?_rsc=a"))]);
    expect(steps[0]!.kind).toBe("fence_prefetch");
    expect(steps[0]!.label).toBe("1 link prefetch blocked by replica fence (expected)");
  });
});
