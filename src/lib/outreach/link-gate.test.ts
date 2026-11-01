import { describe, expect, it } from "vitest";
import { createOwnerToken } from "./tokens";
import { rejectOwnerLink } from "./link-gate";

const SECRET = "unit-test-owner-secret-0123456789";
const NOW = new Date("2026-11-01T12:00:00Z");
const mint = (expiresAt: Date, secret = SECRET) => createOwnerToken({ outreachId: "o-1", expiresAt }, secret).token;

describe("rejectOwnerLink", () => {
  it("returns 404 for a garbage token", () => {
    expect(rejectOwnerLink("/owner/garbage-token", NOW, SECRET)).toEqual({ status: 404, reason: "invalid" });
  });
  it("returns 404 for a forged signature", () => {
    const [body] = mint(new Date(NOW.getTime() + 1000)).split(".");
    expect(rejectOwnerLink(`/owner/${body}.AAAA`, NOW, SECRET)?.status).toBe(404);
  });
  it("returns 404 for a token signed with another secret", () => {
    const t = mint(new Date(NOW.getTime() + 1000), "another-secret-0123456789ab");
    expect(rejectOwnerLink(`/owner/${t}`, NOW, SECRET)?.status).toBe(404);
  });
  it("returns 410 for an expired token", () => {
    expect(rejectOwnerLink(`/owner/${mint(new Date(NOW.getTime() - 1000))}`, NOW, SECRET)).toEqual({ status: 410, reason: "expired" });
  });
  it("lets a valid token through", () => {
    expect(rejectOwnerLink(`/owner/${mint(new Date(NOW.getTime() + 60_000))}`, NOW, SECRET)).toBeNull();
  });
  it("ignores other paths and the error page itself", () => {
    expect(rejectOwnerLink("/dashboard", NOW, SECRET)).toBeNull();
    expect(rejectOwnerLink("/owner/link-error", NOW, SECRET)).toBeNull();
  });
  it("passes through when the secret is too short (the page reports that itself)", () => {
    expect(rejectOwnerLink("/owner/x.y", NOW, "short")).toBeNull();
  });
});
