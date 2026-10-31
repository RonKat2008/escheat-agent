/**
 * Demo clock and navigation. Chat never moves the clock: advance_clock only proposes a date, and the person's
 * "Move clock" click on the card calls /api/clock (the same guarded route as the header control).
 */
import { z } from "zod";
import { clockMutationAllowed, getOffsetDays, now } from "@/lib/clock";
import { addDays, type IsoDate } from "@/lib/dates";
import { findStaleItemId, getAgentRunForCompany } from "@/lib/queries";
import { ChatToolError, defineTool, normalizeItemRef, type ChatToolContext } from "./define";

async function clockState(ctx: ChatToolContext) {
  return { today: await now(ctx.db, ctx.companyId), offsetDays: await getOffsetDays(ctx.db, ctx.companyId) };
}

export const getClockTool = defineTool({
  name: "get_clock",
  label: "Reading the demo clock",
  description: "Returns the app's current (demo) date that every deadline is measured from, and whether the demo clock can be advanced here.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const s = await clockState(ctx);
    return {
      summary: `today is ${s.today}`,
      data: { ...s, canAdvance: clockMutationAllowed() },
      ui: { kind: "clock", props: { ...s, canAdvance: clockMutationAllowed(), proposal: null } },
    };
  },
});

export const advanceClockTool = defineTool({
  name: "advance_clock",
  label: "Proposing a demo-date change",
  description:
    "SIMULATION CONTROL, demo mode only. PROPOSES moving the demo date forward (or back) by N days: it changes nothing itself. The user " +
    "sees a card with a Move clock button and moves the clock with their own click, which recomputes every item's timeline. " +
    "Refused outside demo mode. Only do this when the user asks to move the demo date.",
  input: z.object({ days: z.number().int().min(-3650).max(3650).refine((d) => d !== 0, "days must not be 0") }),
  writes: false,
  async run(ctx, { days }) {
    if (!clockMutationAllowed()) throw new ChatToolError("The demo clock is disabled in this deployment (DEMO_MODE is off).");
    const s = await clockState(ctx);
    const to = addDays(s.today as IsoDate, days);
    return {
      summary: `proposed ${s.today} → ${to}; waiting for the user's click`,
      data: { today: s.today, proposedDate: to, days, moved: false, nextStep: "The user clicks Move clock on the card to apply it." },
      ui: { kind: "clock", props: { ...s, canAdvance: true, proposal: { days, to } } },
    };
  },
});

const VIEWS = {
  dashboard: { href: "/dashboard", title: "Dashboard", description: "Exposure, deadlines and status at a glance." },
  items: { href: "/items", title: "Stale items", description: "Every open item with filters and the legal timeline drawer." },
  approvals: { href: "/approvals", title: "Approvals", description: "Everything waiting on a human: drafts, reports, claims, rule changes." },
  rules: { href: "/rules", title: "Rules", description: "Sourced rule files per state; verify values here." },
  reports: { href: "/reports", title: "Reports", description: "Generate, validate and file NAUPA reports via the replica portal." },
  recoveries: { href: "/recoveries", title: "Recoveries", description: "Money owed back to the company, found on replica portals." },
  runs: { href: "/runs", title: "Agent runs", description: "Every model and browser-agent run with tokens, cost and trace." },
  eval: { href: "/eval", title: "Eval", description: "Stored classifier eval run and how it was measured." },
  integrations: { href: "/settings/integrations", title: "Integrations", description: "QuickBooks, Plaid and CSV imports." },
} as const;

export const openViewTool = defineTool({
  name: "open_view",
  label: "Linking the page",
  description:
    "Returns a link card to an app page. Use when the user wants to go somewhere or when the next step is a human action on a page " +
    "(approving, filing, verifying rules). Optional: item (check number) for the items drawer, state for reports, run_id for a run.",
  input: z.object({
    view: z.enum(Object.keys(VIEWS) as [keyof typeof VIEWS, ...(keyof typeof VIEWS)[]]),
    item: z.string().trim().max(64).optional(),
    state: z.string().regex(/^[A-Za-z]{2}$/).optional(),
    run_id: z.string().uuid().optional(),
  }),
  writes: false,
  async run(ctx, { view, item, state, run_id }) {
    // Ids come from the model (and, through it, the client): only link to things that exist for this company.
    if (view === "items" && item && !(await findStaleItemId(ctx.db, ctx.companyId, normalizeItemRef(item)))) {
      throw new ChatToolError(`No item ${item}.`);
    }
    if (view === "runs" && run_id && !(await getAgentRunForCompany(ctx.db, ctx.companyId, run_id))) {
      throw new ChatToolError(`No agent run ${run_id}.`);
    }
    const base = VIEWS[view];
    let href: string = base.href;
    let title: string = base.title;
    if (view === "items" && item) {
      href = `/items?item=${encodeURIComponent(item.replace(/^#/, ""))}`;
      title = `Item #${item.replace(/^#/, "")}`;
    } else if (view === "reports" && state) {
      href = `/reports?state=${state.toUpperCase()}`;
      title = `${state.toUpperCase()} report`;
    } else if (view === "runs" && run_id) {
      href = `/runs/${run_id}`;
      title = "Agent run";
    }
    return { summary: title, data: { href, title }, ui: { kind: "link", props: { href, title, description: base.description } } };
  },
});
