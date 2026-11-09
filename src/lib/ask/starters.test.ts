import { describe, expect, it } from "vitest";
import {
  APPROVALS_PROMPT,
  askStarters,
  DEADLINES_PROMPT,
  EXPOSURE_PROMPT,
  GET_STARTED_PROMPT,
  INTEGRATIONS_PROMPT,
  MAX_STARTERS,
  offlineAnswerable,
  OVERDUE_PROMPT,
  startersFor,
  UPLOAD_PROMPT,
  type StarterState,
} from "./starters";

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

describe("askStarters: Ask action-card chips", () => {
  const FRESH: StarterState = { ...EMPTY, ledgerRows: 0, overdue: 0, setupDone: 0, setupTotal: 4, integrationsUnconfigured: true };

  it("nothing done yet: 'Get started' is the first chip, then the upload, both coral", () => {
    const s = askStarters(FRESH);
    expect(s.map((x) => x.prompt)).toEqual([GET_STARTED_PROMPT, UPLOAD_PROMPT, EXPOSURE_PROMPT, DEADLINES_PROMPT, INTEGRATIONS_PROMPT]);
    expect(s[0]).toEqual({ prompt: GET_STARTED_PROMPT, tone: "human", hint: "4 steps to do" });
    expect(s[1]?.tone).toBe("human");
    expect(s.at(-1)?.tone).toBe("info");
  });

  it("no 'Get started' once a step is done, and no upload chip once rows exist", () => {
    const prompts = askStarters({ ...FRESH, setupDone: 1, ledgerRows: 733 }).map((x) => x.prompt);
    expect(prompts).not.toContain(GET_STARTED_PROMPT);
    expect(prompts).not.toContain(UPLOAD_PROMPT);
  });

  it("overdue items add a coral 'What's overdue?' with a count hint", () => {
    expect(askStarters({ ...EMPTY, overdue: 3 })[0]).toEqual({ prompt: OVERDUE_PROMPT, tone: "human", hint: "3 overdue" });
  });

  it("keeps the cap and the two reads; integrations only fills a free slot", () => {
    const s = askStarters({ ...FULL, overdue: 5, integrationsUnconfigured: true });
    expect(s).toHaveLength(MAX_STARTERS);
    expect(s.slice(-2).map((x) => x.prompt)).toEqual([EXPOSURE_PROMPT, DEADLINES_PROMPT]);
    expect(s.map((x) => x.prompt)).not.toContain(INTEGRATIONS_PROMPT);
    for (const x of askStarters(FRESH)) if (x.hint) expect(x.hint).toMatch(/^\d+ [a-z ]+$/);
  });

  it("every card chip is answerable offline (no model needed)", () => {
    for (const p of [GET_STARTED_PROMPT, UPLOAD_PROMPT, OVERDUE_PROMPT, INTEGRATIONS_PROMPT]) expect(offlineAnswerable(p), p).toBe(true);
  });
});

describe("startersFor (offline filter)", () => {
  it("offline, keeps only prompts offline chat can answer (the approvals chip opens the review card, no model)", () => {
    const shown = startersFor(askStarters(FULL), true);
    expect(shown.map((x) => x.prompt)).toContain(APPROVALS_PROMPT);
    for (const s of shown) expect(offlineAnswerable(s.prompt), s.prompt).toBe(true);
  });

  it("every slice-1 starter on a fresh seed shape is recorded or answerable offline", () => {
    for (const s of askStarters(FULL)) expect(offlineAnswerable(s.prompt), s.prompt).toBe(true);
  });

  it("online, shows every chip", () => {
    expect(startersFor(askStarters(FULL), false)).toHaveLength(MAX_STARTERS);
  });

  it("offline with nothing answerable falls back to the exposure question", () => {
    expect(startersFor([{ prompt: "Approve the CA report", tone: "human" }], true).map((x) => x.prompt)).toEqual([EXPOSURE_PROMPT]);
  });
});
