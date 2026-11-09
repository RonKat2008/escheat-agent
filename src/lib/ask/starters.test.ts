import { describe, expect, it } from "vitest";
import { APPROVALS_PROMPT, askStarters, DEADLINES_PROMPT, EXPOSURE_PROMPT, MAX_STARTERS, offlineAnswerable, startersFor, type StarterState } from "./starters";

const EMPTY: StarterState = { approvalsWaiting: 0, draftReady: 0, draftCheck: null, toReport: [] };
const FULL: StarterState = {
  approvalsWaiting: 3,
  draftReady: 2,
  draftCheck: "10087",
  toReport: [
    { state: "CA", count: 4 },
    { state: "DE", count: 2 },
    { state: "TX", count: 1 },
  ],
};

describe("askStarters", () => {
  it("falls back to the two always-on reads on an empty state, exposure first", () => {
    const s = askStarters(EMPTY);
    expect(s.map((x) => x.prompt)).toEqual([EXPOSURE_PROMPT, DEADLINES_PROMPT]);
    expect(s.every((x) => x.tone === "info")).toBe(true);
  });

  it("keeps the fixed order: coral actions first, then close-outs, then the reads", () => {
    expect(askStarters(FULL).map((x) => x.prompt)).toEqual([
      APPROVALS_PROMPT,
      "Draft the due-diligence letter for #10087",
      "Close out California for this cycle",
      "Close out Delaware for this cycle",
      EXPOSURE_PROMPT,
      DEADLINES_PROMPT,
    ]);
  });

  it("caps the list at 6 and never drops the always-on reads for a third close-out", () => {
    const s = askStarters(FULL);
    expect(s).toHaveLength(MAX_STARTERS);
    expect(s.map((x) => x.prompt)).not.toContain("Close out Texas for this cycle");
  });

  it("colours chips that need a person coral and read-only chips steel", () => {
    const tones = Object.fromEntries(askStarters(FULL).map((x) => [x.prompt, x.tone]));
    expect(tones[APPROVALS_PROMPT]).toBe("human");
    expect(tones["Draft the due-diligence letter for #10087"]).toBe("human");
    expect(tones["Close out California for this cycle"]).toBe("info");
    expect(tones[EXPOSURE_PROMPT]).toBe("info");
  });

  it("shows no chip when its count is 0 (or there is no check to name)", () => {
    const prompts = askStarters({ ...FULL, approvalsWaiting: 0, draftReady: 0, toReport: [{ state: "CA", count: 0 }] }).map((x) => x.prompt);
    expect(prompts).toEqual([EXPOSURE_PROMPT, DEADLINES_PROMPT]);
    expect(askStarters({ ...EMPTY, draftReady: 3, draftCheck: null }).map((x) => x.prompt)).toEqual([EXPOSURE_PROMPT, DEADLINES_PROMPT]);
  });

  it("only offers close-outs for states with a guided close-out prompt", () => {
    expect(askStarters({ ...EMPTY, toReport: [{ state: "NY", count: 9 }] }).map((x) => x.prompt)).toEqual([EXPOSURE_PROMPT, DEADLINES_PROMPT]);
  });

  it("hints are counts, never dates or amounts", () => {
    for (const s of askStarters(FULL)) if (s.hint) expect(s.hint).toMatch(/^\d+ [a-z ]+$/);
  });
});

describe("startersFor (offline filter)", () => {
  it("offline, keeps only prompts offline chat can answer", () => {
    const shown = startersFor(askStarters(FULL), true);
    expect(shown.map((x) => x.prompt)).not.toContain(APPROVALS_PROMPT);
    for (const s of shown) expect(offlineAnswerable(s.prompt), s.prompt).toBe(true);
  });

  it("every slice-1 starter on a fresh seed shape is recorded or answerable offline, except the approvals read", () => {
    for (const s of askStarters(FULL)) {
      if (s.prompt === APPROVALS_PROMPT) continue;
      expect(offlineAnswerable(s.prompt), s.prompt).toBe(true);
    }
  });

  it("online, shows every chip", () => {
    expect(startersFor(askStarters(FULL), false)).toHaveLength(MAX_STARTERS);
  });

  it("offline with nothing answerable falls back to the exposure question", () => {
    expect(startersFor([{ prompt: APPROVALS_PROMPT, tone: "human" }], true).map((x) => x.prompt)).toEqual([EXPOSURE_PROMPT]);
  });
});
