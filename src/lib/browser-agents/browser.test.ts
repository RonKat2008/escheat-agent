import { describe, expect, it, vi } from "vitest";
import { NonReplicaUrlError } from "@/lib/replica/guard";
import { guardedGoto } from "./browser";
import { compareTotals } from "./filing";

const BASE = "http://localhost:3000";

function fakePage(landing = `${BASE}/replica/ca-holder`) {
  const goto = vi.fn(async () => undefined);
  return { goto, url: () => landing };
}

describe("guardedGoto", () => {
  it.each([
    "https://www.sco.ca.gov/",
    "http://localhost:3000/dashboard",
    "http://localhost:3001/replica/ca-holder",
    "http://localhost:3000/replica/../api/clock",
    "file:///etc/passwd",
  ])("throws and logs without navigating for %s", async (url) => {
    const page = fakePage();
    const step = vi.fn(async () => ({}) as never);
    await expect(guardedGoto(page, url, BASE, { step })).rejects.toBeInstanceOf(NonReplicaUrlError);
    expect(page.goto).not.toHaveBeenCalled();
    expect(step).toHaveBeenCalledWith("guard_blocked", expect.stringContaining("Refused"), expect.anything());
  });

  it("navigates to a replica URL", async () => {
    const page = fakePage();
    await guardedGoto(page, `${BASE}/replica/ca-holder`, BASE);
    expect(page.goto).toHaveBeenCalledOnce();
  });

  it("fails and logs when the page ends up off-replica (redirect)", async () => {
    const page = fakePage("https://evil.example/");
    const step = vi.fn(async () => ({}) as never);
    await expect(guardedGoto(page, `${BASE}/replica/ca-holder`, BASE, { step })).rejects.toBeInstanceOf(NonReplicaUrlError);
    expect(step).toHaveBeenCalledWith("guard_blocked", expect.stringContaining("landed off-replica"), expect.anything());
  });
});

describe("compareTotals", () => {
  const portal = { itemCount: 3, totalCents: 258_950, byCode: [] };
  it("passes when count and total agree", () => {
    expect(compareTotals({ itemCount: 3, totalCents: 258_950 }, portal)).toEqual({ ok: true });
  });
  it("stops with a clear error on any mismatch", () => {
    const r = compareTotals({ itemCount: 4, totalCents: 258_900 }, portal);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("item count: our report 4, portal 3");
      expect(r.error).toContain("total:");
      expect(r.error).toContain("Nothing was submitted");
    }
  });
});
