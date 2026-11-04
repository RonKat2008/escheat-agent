import { describe, expect, it } from "vitest";
import { ownerTextProblem, requiredOwnerElements, statuteDeadline } from "./owner-text";

const TX_STATUTE = "(1) the holder is holding the property; and (2) the holder may be required to deliver the property to the comptroller on or before July 1 if the property is not claimed.";
const OWNER = "Northwind Fixtures, Inc. is holding property for you. We may be required to deliver it to the Texas Comptroller on or before July 1 if it is not claimed.";

const present = (text: string) => Object.fromEntries(requiredOwnerElements(TX_STATUTE, text).map((e) => [e.id, e.present]));

describe("requiredOwnerElements / ownerTextProblem with statute text (R5-02)", () => {
  it("derives holder, holding, property, agency, deadline and claim from the TX statute", () => {
    expect(requiredOwnerElements(TX_STATUTE, "").map((e) => e.id)).toEqual(["holder", "holding", "property", "agency", "deadline", "claim"]);
  });

  it("rejects content-free text that passes the generic checks", () => {
    const t = "Hi, we have money for you.";
    expect(ownerTextProblem(t)).toBeNull();
    const problem = ownerTextProblem(t, TX_STATUTE);
    expect(problem).toMatch(/statute requires more/);
    expect(problem).toMatch(/comptroller/i);
    expect(problem).toMatch(/July 1/);
    expect(present(t)).toMatchObject({ holder: true, holding: false, agency: false, deadline: false, claim: false });
  });

  it("accepts the full owner sentence", () => {
    expect(ownerTextProblem(OWNER, TX_STATUTE)).toBeNull();
    expect(Object.values(present(OWNER)).every(Boolean)).toBe(true);
  });

  it("flags each missing element individually", () => {
    expect(ownerTextProblem("We are holding property for you. We may deliver it to the Comptroller if it is not claimed.", TX_STATUTE)).toMatch(/July 1/);
    expect(ownerTextProblem("We are holding property for you. We may deliver it on July 1 if it is not claimed.", TX_STATUTE)).toMatch(/omptroller/);
    expect(ownerTextProblem("We are holding property for you. We may deliver it to the Comptroller on July 1.", TX_STATUTE)).toMatch(/claim it/);
    expect(ownerTextProblem("We are holding property for you. We may deliver it to the Comptroller on July 1 unless you claim it.", TX_STATUTE)).toBeNull();
    expect(ownerTextProblem("Property is waiting. Reply to claim it before the Comptroller takes it on July 1.", TX_STATUTE)).toMatch(/"we"/);
  });

  it.each(["July 1", "Jul 1", "Jul. 1st", "1 July", "1st of July", "7/1"])("recognises the deadline written as %s", (d) => {
    expect(present(`We are holding property for you; it may go to the Comptroller by ${d} if not claimed.`).deadline).toBe(true);
  });

  it("does not accept a different date", () => {
    expect(present("We are holding property for you; the Comptroller may get it on July 11 if not claimed.").deadline).toBe(false);
    expect(present("We hold property for you; the Comptroller gets it on June 1 if not claimed.").deadline).toBe(false);
  });

  it("accepts the holder's name in place of 'we' when given", () => {
    const text = "Northwind Fixtures, Inc. is holding property for you; the Comptroller may receive it by July 1 if unclaimed.";
    expect(requiredOwnerElements(TX_STATUTE, text, "Northwind Fixtures, Inc.").find((e) => e.id === "holder")?.present).toBe(true);
  });

  it("R6-14: refuses a negated sentence that mentions every keyword", () => {
    const t = "We are not holding any property for you and will never deliver anything to the Comptroller by July 1, so do not reply to claim it.";
    const problem = ownerTextProblem(t, TX_STATUTE);
    expect(problem).toMatch(/denies what the statute requires/);
    expect(problem).toMatch(/holding/);
    expect(present(t)).toMatchObject({ holding: false, property: false, agency: false, deadline: false, claim: false });
  });

  it.each([
    "We are holding property for you. We won't deliver it to the Comptroller on July 1.",
    "We hold no property for you; nothing goes to the Comptroller by July 1, so do not reply to claim it.",
  ])("R6-14: other negations are refused (%s)", (t) => {
    expect(ownerTextProblem(t, TX_STATUTE)).not.toBeNull();
  });

  it("R6-14: statute-style conditionals with 'not' still pass", () => {
    expect(ownerTextProblem(OWNER, TX_STATUTE)).toBeNull();
    expect(ownerTextProblem("Northwind Fixtures, Inc. is holding property for you. If you do not claim it, we may be required to deliver it to the Texas Comptroller on or before July 1.", TX_STATUTE)).toBeNull();
    expect(ownerTextProblem("We are holding property for you. Unless you reply, we will deliver it to the Comptroller by Jul. 1st.", TX_STATUTE)).toBeNull();
  });

  it("still refuses holder-addressed text before checking content", () => {
    expect(ownerTextProblem("You (the holder) are holding the property and may deliver it to the Comptroller by July 1 if not claimed.", TX_STATUTE)).toMatch(/addressed to the holder/);
  });

  it("requires only what the statute calls for (no deadline or agency without them)", () => {
    const ids = requiredOwnerElements("The holder is holding the property.", "").map((e) => e.id);
    expect(ids).not.toContain("deadline");
    expect(ids).not.toContain("agency");
    expect(statuteDeadline("no date here")).toBeNull();
    expect(statuteDeadline(TX_STATUTE)).toEqual({ month: 7, day: 1 });
  });
});
