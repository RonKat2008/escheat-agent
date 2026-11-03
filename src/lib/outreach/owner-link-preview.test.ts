import { describe, expect, it } from "vitest";
import { inertOwnerLinks } from "./owner-link-preview";

describe("inertOwnerLinks (R4-10 preview)", () => {
  it("marks owner anchors inert but keeps the href exactly as composed", () => {
    const html = '<html><head></head><body><a href="https://x.test/owner/abc.def">Respond</a> <a href="https://x.test/help">Help</a></body></html>';
    const out = inertOwnerLinks(html);
    expect(out).toContain('href="https://x.test/owner/abc.def" data-owner-link-pending="true" aria-disabled="true" tabindex="-1"');
    expect(out).toContain('<a href="https://x.test/help">');
    expect(out).toMatch(/<head><style>\[data-owner-link-pending\]/);
  });

  it("strikes a printed owner URL and says it is not active yet", () => {
    const html = '<html><head></head><body><div>Reply at <span class="url">http://localhost:3000/owner/eyJ.sig-_1</span></div></body></html>';
    const out = inertOwnerLinks(html);
    expect(out).toContain('<span data-owner-link-pending="true">http://localhost:3000/owner/eyJ.sig-_1</span>');
    expect(out).toContain("not active until this notice is approved and sent");
  });

  it("leaves HTML without an owner link untouched", () => {
    const html = "<p>No links</p>";
    expect(inertOwnerLinks(html)).toBe(html);
  });
});
