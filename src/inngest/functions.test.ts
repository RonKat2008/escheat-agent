import { describe, expect, it } from "vitest";
import { InngestTestEngine } from "@inngest/test";
import { hello } from "./functions";
import { helloRequested } from "./events";

describe("hello function", () => {
  it("returns a greeting", async () => {
    const t = new InngestTestEngine({ function: hello });
    const { result } = await t.execute({
      events: [{ name: "app/hello.requested", data: { name: "Ada" } }],
    });
    expect(result).toEqual({ message: "Hello, Ada." });
  });

  it("validates event payloads with the Zod schema", () => {
    expect(() => helloRequested.create({ name: "x" })).not.toThrow();
  });
});
