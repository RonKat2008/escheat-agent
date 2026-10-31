/** Demo clock and navigation. The clock mutation reuses /api/clock's guard and recompute path exactly. */
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { ledgerItems, payees, staleItems } from "@/db/schema";
import { advanceClock, clockMutationAllowed, getOffsetDays, now } from "@/lib/clock";
import { notifyClockAdvanced } from "@/lib/pipeline/notify";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import type { ClockUi } from "../ui-types";
import { ChatToolError, defineTool, type ChatToolContext } from "./define";

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
      ui: { kind: "clock", props: { ...s, canAdvance: clockMutationAllowed(), change: null } },
    };
  },
});

async function payeeNames(ctx: ChatToolContext, staleIds: string[]): Promise<Map<string, string>> {
  if (staleIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: staleItems.id, payeeId: staleItems.ownerPayeeId, ledgerId: staleItems.ledgerItemId })
    .from(staleItems)
    .where(inArray(staleItems.id, staleIds));
  const pIds = rows.map((r) => r.payeeId).filter((x): x is string => !!x);
  const ps = pIds.length ? await ctx.db.select({ id: payees.id, name: payees.canonicalName }).from(payees).where(inArray(payees.id, pIds)) : [];
  const ls = await ctx.db
    .select({ id: ledgerItems.id, name: ledgerItems.payeeNameRaw })
    .from(ledgerItems)
    .where(inArray(ledgerItems.id, rows.map((r) => r.ledgerId)));
  return new Map(rows.map((r) => [r.id, ps.find((p) => p.id === r.payeeId)?.name ?? ls.find((l) => l.id === r.ledgerId)?.name ?? "Item"]));
}

export const advanceClockTool = defineTool({
  name: "advance_clock",
  label: "Moving the demo clock",
  description:
    "SIMULATION CONTROL, demo mode only. Moves the demo date forward (or back) by N days and recomputes every item's timeline so the user " +
    "can watch items move (e.g. to dd_pending or to_report). Changes no real-world state. Refused outside demo mode. Only do this when the user asks.",
  input: z.object({ days: z.number().int().min(-3650).max(3650).refine((d) => d !== 0, "days must not be 0") }),
  writes: true,
  async run(ctx, { days }) {
    if (!clockMutationAllowed()) throw new ChatToolError("The demo clock is disabled in this deployment (DEMO_MODE is off).");
    const before = await clockState(ctx);
    await advanceClock(ctx.db, ctx.companyId, days);
    const result = await recomputeTimelines(ctx.db, ctx.companyId);
    const after = await clockState(ctx);
    await notifyClockAdvanced({ companyId: ctx.companyId, offsetDays: after.offsetDays, now: after.today });
    const changed = result.transitions.filter((t) => t.from !== t.to);
    const names = await payeeNames(ctx, changed.slice(0, 12).map((t) => t.staleItemId));
    const change: NonNullable<ClockUi["props"]["change"]> = {
      from: before.today,
      days,
      transitionCount: changed.length,
      deadlinesMoved: result.deadlinesMoved,
      transitions: changed.slice(0, 12).map((t) => ({ payeeName: names.get(t.staleItemId) ?? "Item", from: t.from, to: t.to })),
    };
    const byTarget = changed.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.to]: (acc[t.to] ?? 0) + 1 }), {});
    return {
      summary: `${before.today} → ${after.today}, ${changed.length} items changed status`,
      data: { from: before.today, to: after.today, offsetDays: after.offsetDays, itemsChangedStatus: changed.length, byNewStatus: byTarget },
      ui: { kind: "clock", props: { ...after, canAdvance: true, change } },
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
  async run(_ctx, { view, item, state, run_id }) {
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
