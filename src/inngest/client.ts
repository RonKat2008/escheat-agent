import { Inngest } from "inngest";

/**
 * Dev mode (local Inngest dev server) is used whenever no signing key is configured outside production,
 * or when INNGEST_DEV=1. Production requires INNGEST_SIGNING_KEY / INNGEST_EVENT_KEY.
 */
const useDevServer =
  process.env.INNGEST_DEV === "1" ||
  (process.env.NODE_ENV !== "production" && !process.env.INNGEST_SIGNING_KEY);

export const inngest = new Inngest({ id: "escheat-agent", isDev: useDevServer });

export * from "./events";
