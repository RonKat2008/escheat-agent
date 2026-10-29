import { describe, expect, it } from "vitest";
import { issueState, verifyState } from "./oauth-state";

const CO = "11111111-1111-4111-8111-111111111111";

describe("OAuth state CSRF", () => {
  it("accepts the matching state and returns the company", () => {
    const s = issueState("sec", CO);
    expect(verifyState("sec", s.cookie, s.state)).toEqual({ ok: true, companyId: CO });
  });

  it("rejects a state param that does not match the cookie nonce", () => {
    const s = issueState("sec", CO);
    const other = issueState("sec", CO);
    expect(verifyState("sec", s.cookie, other.state)).toMatchObject({ ok: false });
  });

  it("rejects missing, forged, wrong-secret and expired cookies", () => {
    const s = issueState("sec", CO, 1_000);
    expect(verifyState("sec", undefined, s.state).ok).toBe(false);
    expect(verifyState("sec", s.cookie, null).ok).toBe(false);
    expect(verifyState("sec", `${s.cookie.split(".")[0]}.deadbeef`, s.state).ok).toBe(false);
    expect(verifyState("different", s.cookie, s.state).ok).toBe(false);
    expect(verifyState("sec", s.cookie, s.state, 1_000 + 11 * 60 * 1000)).toEqual({ ok: false, reason: "state expired" });
  });
});
