import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORCHESTRATOR_MODEL, WORKER_MODEL } from "@config/models";
import { setAnthropicClient } from "@/lib/llm/client";
import { jsonMessage, mockClient, type Responder } from "@/lib/llm/testing";
import { classifyBatch, classifyItem, heuristicClassify, type ClassifyContext } from "./classifier";
import type { ClassifierItem } from "./types";

const item: ClassifierItem = {
  kind: "check",
  number: "10482",
  payee_name: "Bayline Electric",
  payee_address: "100 Harbor Way",
  payee_city: "Oakland",
  payee_state: "CA",
  payee_zip: "94607",
  amount_cents: 234000,
  issue_date: "2025-08-01",
  memo: "Invoice 7781 electrical services",
  cleared_date: null,
};
const ctx: ClassifyContext = {
  holder: { name: "Northwind Fixtures, Inc.", stateOfIncorporation: "DE" },
  propertyCodeFor: (state, type) => (type === "vendor_check" ? `NAUPA-${state}-VC` : null),
};
const answer = (o: Partial<Record<string, unknown>> = {}): Responder =>
  jsonMessage({
    property_type: "vendor_check",
    owner_state: "CA",
    owner_state_basis: "address",
    confidence: 0.95,
    rationale: "Vendor invoice memo.",
    ...o,
  });

beforeEach(() => {
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => {
  setAnthropicClient(undefined);
  vi.unstubAllEnvs();
});

describe("classifyItem", () => {
  it("accepts a confident worker answer without escalating; property_code comes from the lookup", async () => {
    const client = mockClient([answer({ property_code: "MODEL-INVENTED" })]);
    setAnthropicClient(client);
    const c = await classifyItem(item, ctx);
    expect(c).toMatchObject({
      method: "worker",
      needs_review: false,
      conflicts: [],
      owner_state: "CA",
      owner_state_basis: "address",
      property_code: "NAUPA-CA-VC",
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe(WORKER_MODEL);
  });

  it("escalates to the orchestrator on low confidence", async () => {
    const client = mockClient([answer({ confidence: 0.5 }), answer({ confidence: 0.9 })]);
    setAnthropicClient(client);
    const c = await classifyItem(item, ctx);
    expect(c.method).toBe("orchestrator");
    expect(c.needs_review).toBe(false);
    expect(client.calls[1]?.model).toBe(ORCHESTRATOR_MODEL);
  });

  it("flags needs_review when the orchestrator is still below 0.8", async () => {
    setAnthropicClient(mockClient([answer({ confidence: 0.5 }), answer({ confidence: 0.7 })]));
    const c = await classifyItem(item, ctx);
    expect(c.method).toBe("orchestrator");
    expect(c.needs_review).toBe(true);
  });

  it("overrides a model owner state that disagrees with the address and records the conflict", async () => {
    const client = mockClient([
      answer({ owner_state: "TX", owner_state_basis: "incorporation" }),
      answer({ owner_state: "CA" }),
    ]);
    setAnthropicClient(client);
    const c = await classifyItem(item, ctx);
    expect(c.owner_state).toBe("CA");
    expect(c.owner_state_basis).toBe("address");
    expect(c.conflicts.join(" ")).toMatch(/worker: Model said owner state TX/);
    expect(client.calls).toHaveLength(2);
  });

  it("uses incorporation state when the payee has no address", async () => {
    setAnthropicClient(
      mockClient([answer({ owner_state: "DE", owner_state_basis: "incorporation" })]),
    );
    const c = await classifyItem(
      { ...item, payee_address: null, payee_city: null, payee_state: null, payee_zip: null },
      ctx,
    );
    expect(c.owner_state).toBe("DE");
    expect(c.owner_state_basis).toBe("incorporation");
  });

  it("falls back to a labeled heuristic only when Anthropic is not configured", async () => {
    const c = await classifyItem(item, ctx);
    expect(c.method).toBe("heuristic");
    expect(c.rationale).toContain("HEURISTIC");
    expect(c.owner_state).toBe("CA");
    expect(c.property_type).toBe("vendor_check");
    expect(c.needs_review).toBe(false);
  });
});

describe("heuristicClassify", () => {
  it("is strong for credits and payroll memos, weak (needs_review) with no signal", () => {
    expect(heuristicClassify({ ...item, kind: "credit" }, ctx)).toMatchObject({ property_type: "customer_credit", needs_review: false });
    expect(heuristicClassify({ ...item, memo: "Final wages" }, ctx).property_type).toBe("payroll_check");
    const weak = heuristicClassify({ ...item, memo: null }, ctx);
    expect(weak.needs_review).toBe(true);
    expect(weak.method).toBe("heuristic");
  });
});

describe("classifyBatch", () => {
  it("classifies all items preserving order", async () => {
    const items = [item, { ...item, kind: "credit" as const }, { ...item, memo: "bonus" }];
    const out = await classifyBatch(items, { ctx, concurrency: 2 });
    expect(out.map((o) => o.property_type)).toEqual(["vendor_check", "customer_credit", "payroll_check"]);
  });
});
