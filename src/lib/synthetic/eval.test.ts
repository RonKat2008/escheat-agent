import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildBundle } from "./build";
import { classifyPropertyType, isStaleAt, resolveOwnerState } from "./labels";
import { DEMO_ANCHOR_DATE, evalCaseSchema } from "./model";

const { generatedCases, adversarialCases } = buildBundle();
const cases = z.array(evalCaseSchema);

describe("eval fixtures", () => {
  it("have exactly 160 generated + 40 adversarial cases that satisfy the schema", () => {
    expect(cases.parse(generatedCases)).toHaveLength(160);
    expect(cases.parse(adversarialCases)).toHaveLength(40);
    expect(generatedCases.every((c) => c.slice === "generated")).toBe(true);
    expect(adversarialCases.every((c) => c.slice === "adversarial")).toBe(true);
    const ids = [...generatedCases, ...adversarialCases].map((c) => c.id);
    expect(new Set(ids).size).toBe(200);
  });

  it("have expected labels consistent with the labeling rules", () => {
    for (const c of [...generatedCases, ...adversarialCases]) {
      const owner = resolveOwnerState(c.item);
      expect(
        { id: c.id, state: owner.owner_state, basis: owner.owner_state_basis },
        `${c.id}: ${owner.reason}`,
      ).toEqual({ id: c.id, state: c.expected.owner_state, basis: c.expected.owner_state_basis });
      expect({ id: c.id, t: classifyPropertyType(c.item.kind, c.item.memo) }).toEqual({
        id: c.id,
        t: c.expected.property_type,
      });
      expect({ id: c.id, s: isStaleAt({ issue_date: c.item.issue_date, cleared_date: c.item.cleared_date }, DEMO_ANCHOR_DATE) }).toEqual({
        id: c.id,
        s: c.expected.is_stale,
      });
    }
  });

  it("generated slice covers all property types, both stale labels, and cleared items", () => {
    expect(new Set(generatedCases.map((c) => c.expected.property_type)).size).toBe(4);
    expect(generatedCases.filter((c) => c.expected.is_stale)).toHaveLength(40);
    expect(generatedCases.some((c) => c.item.cleared_date !== null)).toBe(true);
    expect(generatedCases.some((c) => c.expected.owner_state_basis === "incorporation")).toBe(true);
    expect(new Set(generatedCases.map((c) => c.item.number)).size).toBe(160);
  });

  it("adversarial slice covers the required address and memo hazards", () => {
    const states = new Set(adversarialCases.map((c) => c.expected.owner_state));
    for (const s of ["CA", "TX", "DE", "NY", "WA", "MA", "TN", "IL"]) expect(states.has(s)).toBe(true);
    const find = (re: RegExp) => adversarialCases.some((c) => re.test(JSON.stringify(c.item)));
    expect(find(/Sacramento, Calif\./)).toBe(true);
    expect(find(/Austin Tex/)).toBe(true);
    expect(find(/APO|FPO|DPO/)).toBe(true);
    expect(find(/Toronto/)).toBe(true);
    expect(find(/Califronia/)).toBe(true);
    expect(find(/PO Box|P\.O\. Box/)).toBe(true);
    expect(adversarialCases.filter((c) => !c.expected.is_stale).length).toBeGreaterThanOrEqual(2);
    expect(adversarialCases.filter((c) => c.expected.property_type !== "vendor_check").length).toBeGreaterThanOrEqual(4);
  });
});

describe("resolveOwnerState", () => {
  const base = { payee_address: "", payee_city: "", payee_state: "", payee_zip: "" };
  it("prefers state field over text over ZIP, and falls back to DE", () => {
    expect(resolveOwnerState({ ...base, payee_state: "CA", payee_zip: "75201" }).owner_state).toBe("CA");
    expect(resolveOwnerState({ ...base, payee_city: "Austin, TX", payee_zip: "90012" }).owner_state).toBe("TX");
    expect(resolveOwnerState({ ...base, payee_zip: "90012" })).toMatchObject({ owner_state: "CA", owner_state_basis: "address" });
    expect(resolveOwnerState(base)).toMatchObject({ owner_state: "DE", owner_state_basis: "incorporation" });
    expect(resolveOwnerState({ ...base, payee_zip: "99999-" }).owner_state_basis).toBe("address");
  });
  it("treats military and foreign addresses as not-a-state", () => {
    expect(resolveOwnerState({ ...base, payee_city: "APO", payee_state: "AE", payee_zip: "09012" }).owner_state_basis).toBe("incorporation");
    expect(resolveOwnerState({ ...base, payee_city: "Toronto", payee_state: "ON" }).owner_state_basis).toBe("incorporation");
  });
});
