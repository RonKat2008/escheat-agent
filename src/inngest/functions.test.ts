import { describe, expect, it } from "vitest";
import { InngestTestEngine } from "@inngest/test";
import { hello, itemTimeline, rulesRecompute, functions } from "./functions";
import { helloRequested, itemStaleCreated } from "./events";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const stale = { name: "item/stale.created", data: { staleItemId: ITEM, companyId: COMPANY, ownerState: "CA" } };

describe("hello function", () => {
  it("returns a greeting", async () => {
    const t = new InngestTestEngine({ function: hello });
    const { result } = await t.execute({ events: [{ name: "app/hello.requested", data: { name: "Ada" } }] });
    expect(result).toEqual({ message: "Hello, Ada." });
  });
  it("validates event payloads with the Zod schema", () => {
    expect(() => helloRequested.create({ name: "x" })).not.toThrow();
  });
});

describe("item-timeline", () => {
  it("is registered with the serve route function list", () => {
    expect(functions).toContain(itemTimeline);
    expect(functions).toContain(rulesRecompute);
    expect(() => itemStaleCreated.create({ staleItemId: ITEM, companyId: COMPANY, ownerState: null })).not.toThrow();
  });

  it("stops after the first advance when the item is terminal", async () => {
    const t = new InngestTestEngine({ function: itemTimeline });
    const { result } = await t.execute({
      events: [stale],
      steps: [
        {
          id: "advance-0",
          handler: () => ({ found: true, status: "remitted", today: "2030-01-01", nextWakeAt: null, terminal: true, changed: true }),
        },
      ],
    });
    expect(result).toMatchObject({ staleItemId: ITEM, status: "remitted", iterations: 1 });
  });

  it("registers a wait for clock/advanced matched on companyId after a non-terminal advance", async () => {
    const t = new InngestTestEngine({ function: itemTimeline });
    const { step } = await t.executeStep("wait-clock-0", {
      events: [stale],
      steps: [
        {
          id: "advance-0",
          handler: () => ({ found: true, status: "watching", today: "2026-11-01", nextWakeAt: "2026-11-04", terminal: false, changed: false }),
        },
      ],
    });
    expect(step).toMatchObject({ op: "WaitForEvent", name: "clock/advanced" });
    expect(JSON.stringify(step)).toContain("companyId");
  });
});
