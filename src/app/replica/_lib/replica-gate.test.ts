import { describe, expect, it } from "vitest";
import { REPLICA_NOT_FOUND_PATH, replicaGate } from "./replica-gate";

describe("replicaGate", () => {
  it("passes valid portals and their sub-pages through", () => {
    for (const p of ["/replica/ca-holder", "/replica/tx-search", "/replica/de-holder/upload", "/replica/tx-search/claim/abc"]) {
      expect(replicaGate(p)).toBeNull();
    }
  });

  it("leaves lowercase bare states to their route handlers", () => {
    expect(replicaGate("/replica/ca")).toBeNull();
    expect(replicaGate("/replica/tx")).toBeNull();
  });

  it("redirects a bare state in any other case to the holder portal", () => {
    expect(replicaGate("/replica/CA")).toEqual({ kind: "redirect", to: "/replica/ca-holder" });
    expect(replicaGate("/replica/De")).toEqual({ kind: "redirect", to: "/replica/de-holder" });
    expect(replicaGate("/replica/TX/upload")).toEqual({ kind: "redirect", to: "/replica/tx-holder" });
  });

  it("marks unknown slugs not-found, including uppercase portal slugs and nested paths", () => {
    for (const p of ["/replica/ny-holder", "/replica/CA-HOLDER", "/replica/ny-holder/upload", "/replica/x", "/replica/%E0%A4%A"]) {
      expect(replicaGate(p)).toEqual({ kind: "not-found" });
    }
  });

  it("serves the 404 page with a 404 even when visited directly", () => {
    expect(replicaGate(REPLICA_NOT_FOUND_PATH)).toEqual({ kind: "not-found" });
  });

  it("ignores /replica itself and non-replica paths", () => {
    expect(replicaGate("/replica")).toBeNull();
    expect(replicaGate("/replica/")).toBeNull();
    expect(replicaGate("/dashboard")).toBeNull();
    expect(replicaGate("/replicas/ny")).toBeNull();
  });
});
