import { describe, expect, it } from "vitest";
import { outreachChecks } from "./outreach-checks";
import { discardOf, type OutreachView, type QueueData } from "./queue-data";

const env = { lobConfigured: false } as QueueData["env"];
const base = { channel: "letter", status: "draft", offline: false, readiness: { ready: true, problems: [], warnings: [] }, requiredLanguageVerified: true, dependsOnUnverified: false } as unknown as OutreachView;
const lob = (o: Partial<OutreachView>) => outreachChecks({ ...base, ...o } as OutreachView, env, "", true, 0).find((c) => c.id === "lob")!;
const text = (c: { body: unknown }) => String(c.body);

describe("letter safety check follows the letter's status", () => {
  it("a ready draft may be approved", () => {
    expect(text(lob({}))).toContain("You can approve now.");
  });
  it("a blocked draft never says it can be approved", () => {
    expect(text(lob({ readiness: { ready: false, problems: ["address missing"], warnings: [] } as never }))).not.toContain("You can approve now");
  });
  it("a sent offline letter says nothing was mailed", () => {
    expect(text(lob({ status: "sent", offline: true }))).toMatch(/offline.*Nothing was printed or mailed/);
  });
  it("a cancelled draft says nothing was sent", () => {
    expect(text(lob({ status: "cancelled" }))).toContain("cancelled");
  });
});

describe("discardOf", () => {
  it("reads who and why from tracking.rejected", () => {
    expect(discardOf({ rejected: { by: "Dana Reyes", reason: "Wrong address" } })).toEqual({ by: "Dana Reyes", reason: "Wrong address" });
  });
  it("is null when nothing was discarded", () => {
    expect(discardOf(null)).toBeNull();
    expect(discardOf({})).toBeNull();
  });
});
