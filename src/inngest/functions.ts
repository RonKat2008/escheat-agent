import { inngest } from "./client";
import { helloRequested } from "./events";

/** Placeholder to prove the Inngest wiring end to end. Replaced by the per-item timeline in Phase 6. */
export const hello = inngest.createFunction(
  { id: "hello", triggers: [helloRequested] },
  async ({ event, step }) => {
    const message = await step.run("compose", () => `Hello, ${event.data.name}.`);
    return { message };
  },
);

export const functions = [hello];
