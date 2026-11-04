import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => send(...a) },
  clockAdvanced: { create: (x: unknown) => x },
  itemStaleCreated: { create: (x: unknown) => x },
}));

import { notifyClockAdvanced, resetInngestDownCache } from "./notify";

describe("notifyClockAdvanced", () => {
  beforeEach(() => {
    send.mockReset();
    resetInngestDownCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does not wait on the dev server again once a send has failed", async () => {
    send.mockImplementation(() => new Promise(() => {})); // never settles: dev server not running
    const args = { companyId: "c", offsetDays: 0, now: "2026-11-01" };
    expect(await notifyClockAdvanced(args)).toBe(false);
    const t0 = Date.now();
    expect(await notifyClockAdvanced(args)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports true when the send succeeds", async () => {
    send.mockResolvedValue(undefined);
    expect(await notifyClockAdvanced({ companyId: "c", offsetDays: 0, now: "2026-11-01" })).toBe(true);
  });
});
