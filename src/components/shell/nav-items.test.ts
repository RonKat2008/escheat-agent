import { describe, expect, it } from "vitest";
import { activeSection, MODE_HREFS, NAV_ITEMS, NAV_SECTIONS, sectionPages, SETTINGS_ITEM } from "./nav-items";

/** Every page that belongs to a Dashboard section (Ask is a mode, not a section). */
const SECTION_PAGES = [...NAV_ITEMS, SETTINGS_ITEM].filter((i) => !MODE_HREFS.includes(i.href));

describe("NAV_SECTIONS (V4 pill nav)", () => {
  it("has 4 to 6 sections, each opening a real sidebar page", () => {
    expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(4);
    expect(NAV_SECTIONS.length).toBeLessThanOrEqual(6);
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const s of NAV_SECTIONS) expect(hrefs.has(s.href), s.href).toBe(true);
  });

  it("puts every sidebar page (and Settings) in exactly one section", () => {
    for (const item of SECTION_PAGES) {
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

  it("keeps Ask out of every section but in the menu sheet, active for the old /chat path too", () => {
    expect(activeSection("/ask")).toBeNull();
    expect(activeSection("/chat")).toBeNull();
    const ask = NAV_ITEMS.find((i) => i.href === "/ask");
    expect(ask?.label).toBe("Ask");
    expect(NAV_ITEMS.some((i) => i.href === "/chat")).toBe(false);
    expect(NAV_SECTIONS.find((s) => s.id === "agents")?.match).toEqual(["/runs", "/theater", "/eval"]);
  });

  it("does not match on a shared prefix that is not a path segment", () => {
    expect(activeSection("/items-archive")).toBeNull();
    expect(activeSection("/replica/tx-search")).toBeNull();
  });

  it("lists every page in exactly one section dropdown, the section's own page first", () => {
    const listed = NAV_SECTIONS.flatMap((s) => sectionPages(s).map((p) => p.href));
    expect([...listed].sort()).toEqual(SECTION_PAGES.map((i) => i.href).sort());
    for (const s of NAV_SECTIONS) expect(sectionPages(s)[0]?.href, s.id).toBe(s.href);
    expect(sectionPages(NAV_SECTIONS.find((s) => s.id === "work")!).map((p) => p.href)).toEqual(["/items", "/payees", "/forecast", "/horizon", "/what-if", "/activity"]);
  });
});
