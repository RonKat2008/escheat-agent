import { describe, expect, it } from "vitest";
import { activeSection, NAV_ITEMS, NAV_SECTIONS, SETTINGS_ITEM } from "./nav-items";

describe("NAV_SECTIONS (V4 pill nav)", () => {
  it("has 4 to 6 sections, each opening a real sidebar page", () => {
    expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(4);
    expect(NAV_SECTIONS.length).toBeLessThanOrEqual(6);
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const s of NAV_SECTIONS) expect(hrefs.has(s.href), s.href).toBe(true);
  });

  it("puts every sidebar page (and Settings) in exactly one section", () => {
    for (const item of [...NAV_ITEMS, SETTINGS_ITEM]) {
      const owners = NAV_SECTIONS.filter((s) => s.match.some((m) => item.href === m || item.href.startsWith(`${m}/`)));
      expect(
        owners.map((o) => o.id),
        item.href,
      ).toHaveLength(1);
    }
  });

  it("marks the section for nested routes and the root path", () => {
    expect(activeSection("/")?.id).toBe("overview");
    expect(activeSection("/items")?.id).toBe("work");
    expect(activeSection("/close-out/CA")?.id).toBe("setup");
    expect(activeSection("/settings/integrations")?.id).toBe("setup");
    expect(activeSection("/runs/abc")?.id).toBe("agents");
    expect(activeSection("/approvals")?.id).toBe("approvals");
  });

  it("does not match on a shared prefix that is not a path segment", () => {
    expect(activeSection("/items-archive")).toBeNull();
    expect(activeSection("/replica/tx-search")).toBeNull();
  });
});
