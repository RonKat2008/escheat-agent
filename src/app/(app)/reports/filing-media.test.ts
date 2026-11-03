import { describe, expect, it } from "vitest";
import { filingMedia } from "./filing-media";

const RUN = "11111111-1111-4111-8111-111111111111";

describe("filingMedia", () => {
  it("lists the run's screenshots by trace step and its video", () => {
    const trace = [{ message: "Open portal" }, { message: "Signed in", screenshot: "/a/1.png" }, null, { screenshot: "/a/3.PNG" }, { screenshot: "/a/x.txt" }];
    const m = filingMedia(RUN, trace, { video: "/a/session.webm" });
    expect(m).toEqual({
      runId: RUN,
      shots: [
        { step: 1, src: `/runs/${RUN}/shots/1`, label: "Signed in" },
        { step: 3, src: `/runs/${RUN}/shots/3`, label: "Step 4" },
      ],
      video: `/reports/runs/${RUN}/video`,
    });
  });

  it("keeps only the latest shots", () => {
    const trace = Array.from({ length: 10 }, (_, i) => ({ screenshot: `/a/${i}.png` }));
    expect(filingMedia(RUN, trace, null, 3)!.shots.map((s) => s.step)).toEqual([7, 8, 9]);
  });

  it("is null without a run or without any media", () => {
    expect(filingMedia(null, [{ screenshot: "/a.png" }], null)).toBeNull();
    expect(filingMedia(RUN, [{ message: "x" }], { video: "/a.mp4" })).toBeNull();
    expect(filingMedia(RUN, "nope", null)).toBeNull();
  });
});
