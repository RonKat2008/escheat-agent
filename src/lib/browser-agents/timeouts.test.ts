import { describe, expect, it } from "vitest";
import {
  AgentDeadlineError,
  agentTimeouts,
  BASE_TIMEOUTS,
  isTimeoutError,
  portalDeadlineMessage,
  settledWithin,
  timeoutMessage,
  withDeadline,
} from "./timeouts";

const never = () => new Promise<never>(() => undefined);
const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

// R9-01: a filing run that cannot finish must fail within about a minute, not hang for 9-12 minutes.
describe("agentTimeouts", () => {
  it("bounds every step in production: 20 s actions, 30 s navigations, 60 s before the irreversible click", () => {
    const t = agentTimeouts("scripted", { NODE_ENV: "production" });
    expect(t).toEqual(BASE_TIMEOUTS);
    expect(t.stepMs).toBe(20_000);
    expect(t.navMs).toBe(30_000);
    expect(t.portalDeadlineMs).toBe(60_000);
  });

  it("gives next dev (route compiles) and Stagehand (model calls) more room, but never unbounded", () => {
    const dev = agentTimeouts("scripted", { NODE_ENV: "development" });
    expect(dev.stepMs).toBe(60_000);
    expect(dev.portalDeadlineMs).toBe(180_000);
    const live = agentTimeouts("stagehand", { NODE_ENV: "production" });
    expect(live.portalDeadlineMs).toBe(180_000);
    // The trace write wait never scales: the agent must not wait long on the database.
    expect(dev.recorderWaitMs).toBe(BASE_TIMEOUTS.recorderWaitMs);
    for (const v of Object.values(live)) expect(Number.isFinite(v) && v > 0).toBe(true);
  });
});

describe("withDeadline", () => {
  it("returns the work's result when it finishes in time", async () => {
    await expect(withDeadline(after(5, "ok"), 200, () => new Error("late"))).resolves.toBe("ok");
  });

  it("rejects with the onTimeout error and runs the abort hook when the work hangs", async () => {
    let aborted = false;
    const started = Date.now();
    const p = withDeadline(never(), 30, async () => {
      aborted = true;
      return new AgentDeadlineError("stopped");
    });
    await expect(p).rejects.toThrow(AgentDeadlineError);
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("passes the work's own error through, and a rejection after the deadline is not unhandled", async () => {
    await expect(withDeadline(Promise.reject(new Error("boom")), 200, () => new Error("late"))).rejects.toThrow("boom");
    const late = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("closed")), 40));
    await expect(withDeadline(late, 10, () => new Error("deadline"))).rejects.toThrow("deadline");
    await after(60, null); // the late rejection lands here; vitest fails the run on an unhandled rejection
  });
});

describe("settledWithin", () => {
  it("is true for a write that lands in time (even a failed one) and false for a stuck one, without throwing", async () => {
    await expect(settledWithin(after(5, 1), 200)).resolves.toBe(true);
    await expect(settledWithin(Promise.reject(new Error("x")), 200)).resolves.toBe(true);
    const started = Date.now();
    await expect(settledWithin(never(), 30)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("timeout messages", () => {
  const playwright = Object.assign(
    new Error("locator.innerText: Timeout 20000ms exceeded.\nCall log:\n\u001b[2m  - waiting for getByTestId('summary-item-count')\u001b[22m\n"),
    { name: "TimeoutError" },
  );

  it("recognises Playwright timeouts only", () => {
    expect(isTimeoutError(playwright)).toBe(true);
    expect(isTimeoutError(new Error("Portal summary does not match"))).toBe(false);
    expect(isTimeoutError("nope")).toBe(false);
  });

  it("says what was waited for, for how long, and that nothing was submitted, without ANSI codes", () => {
    const m = timeoutMessage(playwright, "while reading the portal's summary");
    expect(m).toBe(
      "The replica portal did not respond within 20 s while reading the portal's summary (waiting for getByTestId('summary-item-count')). Nothing was submitted.",
    );
    expect(m).not.toContain("\u001b");
  });

  it("names the deadline and the step it stopped at", () => {
    expect(portalDeadlineMessage(60_000, "while waiting for the portal's review page")).toBe(
      "The filing agent stopped after 60 s while waiting for the portal's review page: the replica portal did not answer in time. Nothing was submitted.",
    );
  });
});
