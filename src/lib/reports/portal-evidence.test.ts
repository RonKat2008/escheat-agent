import { describe, expect, it } from "vitest";
import { portalEvidence } from "./portal-evidence";

const trace = [
  { at: "t0", kind: "action", message: "Signed in", screenshot: "/abs/dashboard.png" },
  { at: "t1", kind: "extract", message: "Portal summary: 1 items, $1574.10, 1 property codes", screenshot: "/abs/portal-summary.png", data: { summary: { itemCount: 1, totalCents: 157410, byCode: [{}] } } },
  { at: "t2", kind: "paused", message: "Paused", screenshot: "/abs/paused.png" },
];

describe("portalEvidence", () => {
  it("takes the portal summary from the run's extract step and the latest screenshot from the run", () => {
    expect(portalEvidence("run-1", trace)).toEqual({
      runId: "run-1",
      summary: { itemCount: 1, totalCents: 157410 },
      shot: { step: 2, src: "/runs/run-1/shots/2", label: "Paused" },
    });
  });

  it("returns null summary when the run never extracted one (nothing is invented)", () => {
    expect(portalEvidence("r", [{ kind: "info", message: "x" }])).toEqual({ runId: "r", summary: null, shot: null });
  });

  it("returns null without a run", () => {
    expect(portalEvidence(null, trace)).toBeNull();
    expect(portalEvidence("r", "not a trace")).toEqual({ runId: "r", summary: null, shot: null });
  });
});
