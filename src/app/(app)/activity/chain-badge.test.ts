import { describe, expect, it } from "vitest";
import { chainBadgeLabel } from "./ChainBadge";

const HEAD = "3f9a" + "0".repeat(56) + "c21e";

describe("chainBadgeLabel", () => {
  it("reads 'Chain verified · N events · head 3f9a…c21e' when it verifies", () => {
    expect(chainBadgeLabel({ ok: true, length: 12, headHash: HEAD })).toBe("Chain verified · 12 events · head 3f9a…c21e");
    expect(chainBadgeLabel({ ok: true, length: 1, headHash: HEAD })).toBe("Chain verified · 1 event · head 3f9a…c21e");
  });

  it("reads 'Chain broken at #N' when it does not", () => {
    expect(chainBadgeLabel({ ok: false, length: 12, headHash: HEAD, firstBrokenSeq: 4 })).toBe("Chain broken at #4");
  });
});
