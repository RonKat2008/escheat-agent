import { describe, expect, it } from "vitest";
import { US_STATES, resolveOwnerState, type OwnerStateInput } from "./priority";
import { zipToArea } from "./zip3";

const holder = { stateOfIncorporation: "DE" };
const r = (payee: OwnerStateInput["payee"], h = holder) => resolveOwnerState({ payee, holder: h });

describe("US_STATES", () => {
  it("has 50 states plus DC", () => {
    expect(Object.keys(US_STATES)).toHaveLength(51);
    expect(US_STATES.DC).toBe("District of Columbia");
  });
});

describe("resolveOwnerState: address wins", () => {
  const cases: Array<[string, OwnerStateInput["payee"], string, string]> = [
    ["2-letter field", { state: "CA" }, "CA", "explicit_state"],
    ["lowercase field", { state: "tx" }, "TX", "explicit_state"],
    ["full name field", { state: "Texas" }, "TX", "explicit_state"],
    ["full name mixed case", { state: "new YORK" }, "NY", "explicit_state"],
    ["Calif. in field", { state: "Calif." }, "CA", "explicit_state"],
    ["Tex. in field", { state: "Tex." }, "TX", "explicit_state"],
    ["padded field", { state: "  wa " }, "WA", "explicit_state"],
    ["DC field", { state: "DC" }, "DC", "explicit_state"],
    ["D.C. field", { state: "D.C." }, "DC", "explicit_state"],
    ["District of Columbia field", { state: "District of Columbia" }, "DC", "explicit_state"],
    ["Sacramento, Calif.", { city: "Sacramento, Calif." }, "CA", "address_text"],
    ["Austin, TX in city", { city: "Austin, TX" }, "TX", "address_text"],
    ["Austin TX 78701 in address", { address: "100 Congress Ave, Austin TX 78701" }, "TX", "address_text"],
    ["city w/ full state after comma", { city: "Portland, Oregon" }, "OR", "address_text"],
    ["Washington, DC in city", { city: "Washington, DC" }, "DC", "address_text"],
    ["Washington, PA is PA not WA", { city: "Washington, PA" }, "PA", "address_text"],
    ["Indiana, PA is PA", { city: "Indiana, PA" }, "PA", "address_text"],
    ["Columbus Ohio no comma", { city: "Columbus Ohio" }, "OH", "address_text"],
    ["ZIP only CA", { zip: "94105" }, "CA", "zip"],
    ["ZIP only TX", { zip: "78701-1234" }, "TX", "zip"],
    ["ZIP only DE", { zip: "19801" }, "DE", "zip"],
    ["ZIP only DC", { zip: "20001" }, "DC", "zip"],
    ["ZIP only NY (leading zero state NJ)", { zip: "07030" }, "NJ", "zip"],
    ["ZIP only MA", { zip: "02134" }, "MA", "zip"],
    ["ZIP in address line", { address: "5 Main St 60614" }, "IL", "zip"],
  ];
  for (const [name, payee, state, reason] of cases) {
    it(name, () => {
      const res = r(payee);
      expect(res.state).toBe(state);
      expect(res.reason).toBe(reason);
      expect(res.basis).toBe("address");
    });
  }

  it("Delaware payee with DE holder still reports address basis", () => {
    expect(r({ state: "DE" })).toMatchObject({ state: "DE", basis: "address" });
  });
});

describe("resolveOwnerState: conflicts", () => {
  it("explicit state beats a contradicting ZIP and flags conflict", () => {
    const res = r({ state: "CA", zip: "78701" });
    expect(res).toMatchObject({ state: "CA", basis: "address", reason: "conflict" });
  });
  it("explicit state beats contradicting address text", () => {
    expect(r({ state: "NY", city: "Austin, TX" })).toMatchObject({ state: "NY", reason: "conflict" });
  });
  it("address text beats contradicting ZIP", () => {
    expect(r({ city: "Austin, TX", zip: "94105" })).toMatchObject({ state: "TX", reason: "conflict" });
  });
  it("agreeing explicit + ZIP is not a conflict", () => {
    expect(r({ state: "CA", zip: "94105" }).reason).toBe("explicit_state");
  });
});

describe("resolveOwnerState: fallback to incorporation", () => {
  const cases: Array<[string, OwnerStateInput["payee"], string]> = [
    ["empty payee", {}, "no_address"],
    ["blank strings", { address: " ", city: "", state: null, zip: "" }, "no_address"],
    ["APO AE", { address: "PSC 1234 Box 5", city: "APO", state: "AE", zip: "09012" }, "military"],
    ["APO AP via zip", { city: "FPO", zip: "96601" }, "military"],
    ["AA zip only", { zip: "34090" }, "military"],
    ["Canada by field", { city: "Toronto", state: "ON" }, "foreign"],
    ["Canada by country word", { address: "1 Yonge St, Toronto, Canada" }, "foreign"],
    ["Canadian postal code", { city: "Vancouver", zip: "V6B 1A1" }, "foreign"],
    ["Puerto Rico field", { state: "PR", zip: "00901" }, "territory"],
    ["Puerto Rico zip", { zip: "00920" }, "territory"],
    ["Guam zip", { zip: "96910" }, "territory"],
    ["USVI zip", { zip: "00802" }, "territory"],
    ["unknown city only", { city: "Springfield" }, "undetermined"],
    ["garbage state", { state: "ZZ" }, "undetermined"],
  ];
  for (const [name, payee, reason] of cases) {
    it(`${name} -> incorporation (${reason})`, () => {
      const res = r(payee);
      expect(res).toMatchObject({ state: "DE", basis: "incorporation", reason });
    });
  }

  it("explicit territory is not overridden by a state ZIP", () => {
    expect(r({ state: "PR", zip: "94105" }).basis).toBe("incorporation");
  });
  it("normalizes the holder's incorporation state", () => {
    expect(r({}, { stateOfIncorporation: "delaware" }).state).toBe("DE");
    expect(r({}, { stateOfIncorporation: "tx" }).state).toBe("TX");
  });
  it("garbage ZIP prefix is undetermined", () => {
    expect(r({ zip: "00100" }).basis).toBe("incorporation");
  });
});

describe("zip3 table", () => {
  it("covers every assigned prefix sampled", () => {
    expect(zipToArea("10001")).toBe("NY");
    expect(zipToArea("90210")).toBe("CA");
    expect(zipToArea("98101")).toBe("WA");
    expect(zipToArea("99501")).toBe("AK");
    expect(zipToArea("96813")).toBe("HI");
    expect(zipToArea("75201")).toBe("TX");
    expect(zipToArea("79901")).toBe("TX");
    expect(zipToArea("73301")).toBe("TX");
    expect(zipToArea("00501")).toBe("NY");
    expect(zipToArea("abcde")).toBeNull();
    expect(zipToArea(null)).toBeNull();
  });
});
