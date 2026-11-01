import { describe, expect, it } from "vitest";
import { bareStateRedirect } from "./portals";

describe("bareStateRedirect", () => {
  it("sends a bare state code to that state's holder portal", () => {
    expect(bareStateRedirect("ca")).toBe("/replica/ca-holder");
    expect(bareStateRedirect("TX")).toBe("/replica/tx-holder");
  });
  it("returns null for real slugs and unknown values", () => {
    expect(bareStateRedirect("ca-holder")).toBeNull();
    expect(bareStateRedirect("ny")).toBeNull();
    expect(bareStateRedirect(undefined)).toBeNull();
  });
});
