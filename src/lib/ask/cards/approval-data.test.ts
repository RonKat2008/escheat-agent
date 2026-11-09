import { describe, expect, it } from "vitest";
import type { QueueEntry, QueueKind } from "@/app/(app)/approvals/queue-data";
import { approvalsHint } from "../starters";
import { summarizeWaiting, waitingForApproval } from "./approval-data";

/** A minimal queue entry: only the fields the Ask waiting definition reads. */
const entry = (over: { actionable?: boolean; statusKey?: string; kind?: QueueKind; outreach?: { channel: string; composed: boolean; status: string } | null }): QueueEntry<QueueKind> =>
  ({ actionable: true, statusKey: "draft", kind: "letter", outreach: null, ...over }) as unknown as QueueEntry<QueueKind>;

const letter = (composed: boolean, status = "draft") => entry({ outreach: { channel: "letter", composed, status } });

describe("R11-06: one definition of 'waiting' for the chip and both cards", () => {
  it("splits what waits into ready and to-compose, and the parts add up to the total", () => {
    expect(summarizeWaiting([letter(false), letter(false), letter(true)])).toEqual({ total: 3, toCompose: 2, ready: 1 });
  });

  it("is exactly the review card's list (waitingForApproval)", () => {
    const entries = [letter(false), entry({ actionable: false }), entry({ kind: "report" }), entry({ statusKey: "approved" })];
    expect(summarizeWaiting(entries).total).toBe(waitingForApproval(entries).length);
    expect(summarizeWaiting(entries).total).toBe(2);
  });

  it("only letters need composing; a report never does", () => {
    expect(summarizeWaiting([entry({ kind: "report" })])).toEqual({ total: 1, toCompose: 0, ready: 1 });
  });

  it("the chip hint matches the split the cards show", () => {
    const s = summarizeWaiting([letter(false), letter(false)]);
    expect(approvalsHint(s.total, s.toCompose)).toBe("2 to compose");
    const m = summarizeWaiting([letter(false), letter(true), entry({ kind: "report" })]);
    expect(approvalsHint(m.total, m.toCompose)).toBe("2 ready, 1 to compose");
    expect(approvalsHint(3, 0)).toBe("3 waiting");
  });
});
