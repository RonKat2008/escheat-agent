import { describe, expect, it } from "vitest";
import { addressedToHolderText, hasUnnegated, needsOwnerText, ownerFacingLanguage, ownerTextProblem } from "./owner-text";

const TX_STATUTE =
  "(1) You (the holder) are holding the property; and (2) You (the holder) may be required to deliver the property to the Comptroller's office on or before July 1 if the property is not claimed.";
const OWNER = "Northwind Fixtures, Inc. is holding property for you. We may be required to deliver it to the Texas Comptroller on or before July 1 if it is not claimed.";
const CA = "THE STATE OF CALIFORNIA REQUIRES US TO NOTIFY YOU THAT YOUR UNCLAIMED PROPERTY MAY BE TRANSFERRED TO THE STATE IF YOU DO NOT CONTACT US";

describe("ownerFacingLanguage (R4-01 letter text selection)", () => {
  it("prints the approved owner sentence, never the holder-addressed statute text", () => {
    const r = ownerFacingLanguage({ value: TX_STATUTE, owner_text: OWNER });
    expect(r).toEqual({ text: OWNER, from: "owner_text", problem: null });
    expect(r.text).not.toMatch(/the holder/i);
  });

  it("refuses holder-addressed statute text that has no owner sentence", () => {
    const r = ownerFacingLanguage({ value: TX_STATUTE });
    expect(r.text).toBeNull();
    expect(r.problem).toMatch(/addressed to the holder/);
  });

  it("prints a value that already speaks to the owner (CA, DE) and nothing for an unknown value", () => {
    expect(ownerFacingLanguage({ value: CA })).toEqual({ text: CA, from: "value", problem: null });
    expect(ownerFacingLanguage({ value: null })).toEqual({ text: null, from: null, problem: null });
    expect(ownerFacingLanguage({ value: CA, owner_text: "   " }).from).toBe("value");
  });
});

describe("ownerTextProblem", () => {
  it("requires a full owner-addressed sentence", () => {
    expect(ownerTextProblem("")).toMatch(/Write the sentence/);
    expect(ownerTextProblem("Hi there.")).toMatch(/full sentence/);
    expect(ownerTextProblem(TX_STATUTE)).toMatch(/addressed to the holder/);
    expect(ownerTextProblem("You, the holder, must deliver this property to the state.")).toMatch(/holder/);
    expect(ownerTextProblem("We are holding [OWNER] property for you until July 1.")).toMatch(/placeholder/);
    expect(ownerTextProblem("x".repeat(2_001))).toMatch(/under/);
    expect(ownerTextProblem(OWNER)).toBeNull();
    // The composer fills the Delaware date slot, so it is allowed.
    expect(ownerTextProblem("We must transfer your property unless you contact us before [insert date that is 30 days after the date of this notice.]")).toBeNull();
  });

  it("knows which rule paths are printed in owner letters", () => {
    expect(needsOwnerText("dueDiligence.requiredLanguage")).toBe(true);
    expect(needsOwnerText("dueDiligence.mailingMethod")).toBe(false);
    expect(addressedToHolderText("Northwind is the holder of your property.")).toBe(false);
  });
});

describe("R7-07 owner wording guard", () => {
  const refused = (t: string) => ownerTextProblem(t, TX_STATUTE, "Northwind Fixtures, Inc.");
  it("refuses a negator followed by 'even if' (a concession is not a condition)", () => {
    const t = "We are holding a check for you. We will not deliver it to the Texas Comptroller by July 1 even if you never claim it.";
    expect(hasUnnegated("We will not deliver it to the Texas Comptroller even if you never claim it", /Comptroller/i)).toBe(false);
    expect(refused(t)).toMatch(/denies what the statute requires/);
  });
  it("refuses keyword salad", () => {
    expect(refused("Hold property claim Texas Comptroller July 1 we")).toMatch(/full sentence/);
    expect(refused("Hold property claim Texas Comptroller July 1 we and you")).toMatch(/statute requires more/);
  });
  it("refuses 'no reason to claim' even when a later clause mentions contacting us", () => {
    const t = "There is no reason to claim. We're holding property for you, and it goes to the Texas Comptroller on or before July 1 unless you contact us.";
    expect(refused(t)).toMatch(/denies what the statute requires/);
  });
  it("still allows a condition that opens the clause before the negator", () => {
    expect(hasUnnegated("If it is not claimed we deliver it to the Comptroller", /claimed/i)).toBe(true);
    expect(refused(OWNER)).toBeNull();
    expect(refused("Northwind Fixtures, Inc. is holding property for you. If it is not claimed, we may be required to deliver it to the Texas Comptroller on or before July 1.")).toBeNull();
  });
  it("keeps the earlier refusals", () => {
    expect(refused("We are not holding any property for you. We will never deliver it to the Texas Comptroller by July 1, claim it.")).toMatch(/denies/);
    expect(refused("We hold no property for you. Nothing will be delivered to the Texas Comptroller by July 1; contact us.")).toMatch(/denies/);
  });
});
