/** Read-only compliance tools. Thin wrappers over src/lib/queries, the same read model the dashboard and MCP use. */
import { z } from "zod";
import {
  explainItem,
  findStaleItemId,
  getAuditInterestExposure,
  getExposure,
  getForecast,
  listStaleItems,
  PropertyTypeSchema,
  SortSchema,
  StaleStatusSchema,
  upcomingDeadlines,
} from "@/lib/queries";
import { DEFAULT_HORIZON_MONTHS, MAX_HORIZON_MONTHS, MIN_HORIZON_MONTHS } from "@/lib/forecast/compute";
import { formatUSD } from "@/lib/money";
import type { ForecastUi } from "../ui-types";
import { ChatToolError, defineTool, ITEM_REF, normalizeItemRef, plural, STATE } from "./define";

export const getExposureTool = defineTool({
  name: "get_exposure",
  label: "Totaling exposure by state",
  description:
    "Answers 'What do we owe in unclaimed property, and where?'. Returns total dollars and item count of OPEN stale items " +
    "broken down by owner state, workflow status and property type, plus whether any figure depends on an UNVERIFIED rule. " +
    "Optionally restrict to one state. Call this first for any high-level 'how much / where' question.",
  input: z.object({ state: STATE.optional() }),
  writes: false,
  async run(ctx, { state }) {
    const e = await getExposure(ctx.db, ctx.companyId, { state });
    return {
      summary: `${plural(e.itemCount, "open item")}, ${e.total.formatted}${state ? ` in ${state}` : ""}`,
      data: {
        asOf: e.asOf,
        total: e.total.formatted,
        itemCount: e.itemCount,
        anyUnverified: e.anyUnverified,
        byState: e.byState.map((s) => ({ state: s.state, total: s.formatted, count: s.count, unverified: s.anyUnverified })),
        // Money in states with no rules file is real liability but has NO dates: never imply a deadline for these.
        inScope: { states: e.coverage.inScope.states, total: e.coverage.inScope.formatted, count: e.coverage.inScope.count },
        notCovered: {
          states: e.coverage.notCovered.states,
          total: e.coverage.notCovered.formatted,
          count: e.coverage.notCovered.count,
          byState: e.coverage.notCovered.byState.map((s) => ({ state: s.state, total: s.formatted, count: s.count })),
          note: e.coverage.notCovered.note,
        },
        byStatus: e.byStatus.map((s) => ({ status: s.status, total: s.formatted, count: s.count })),
        byPropertyType: e.byPropertyType.map((p) => ({ type: p.propertyType, total: p.formatted, count: p.count })),
      },
      ui: { kind: "exposure", props: { exposure: e, state: state ?? null } },
    };
  },
});

export const listStaleItemsTool = defineTool({
  name: "list_stale_items",
  label: "Listing stale items",
  description:
    "Lists open stale/unclaimed items (one per uncashed check or credit) with payee, check number, amount, age, owner state, " +
    "status and next deadline with its verified flag. Use for drill-downs like 'show CA items', 'anything over $5,000?', " +
    "'oldest Texas items'. For one item's full legal timeline use explain_item.",
  input: z.object({
    state: STATE.optional(),
    status: StaleStatusSchema.optional(),
    property_type: PropertyTypeSchema.optional(),
    min_amount_dollars: z.number().nonnegative().max(100_000_000).optional().describe("Only items at least this many dollars"),
    min_age_days: z.number().int().nonnegative().max(36_500).optional(),
    search: z.string().trim().max(80).optional().describe("Matches payee name or check number"),
    needs_review: z.boolean().optional(),
    sort: SortSchema.optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 25"),
  }),
  writes: false,
  async run(ctx, a) {
    const minCents = a.min_amount_dollars === undefined ? undefined : Math.round(a.min_amount_dollars * 100);
    const limit = a.limit ?? 25;
    // The read model has no amount filter; fetch the open set sorted by amount and filter here (open sets are small).
    const r = await listStaleItems(ctx.db, ctx.companyId, {
      state: a.state,
      status: a.status,
      propertyType: a.property_type,
      minAgeDays: a.min_age_days,
      search: a.search,
      needsReview: a.needs_review,
      sort: a.sort ?? (minCents !== undefined ? "amount_desc" : "age_desc"),
      limit: minCents !== undefined ? 500 : limit,
    });
    const filtered = minCents !== undefined ? r.items.filter((i) => i.amount.cents >= minCents) : r.items;
    const items = filtered.slice(0, limit);
    const total = minCents !== undefined ? filtered.length : r.total;
    const filters = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>;
    return {
      summary: `${plural(total, "matching item")}`,
      data: {
        asOf: r.asOf,
        total,
        shown: items.length,
        items: items.map((i) => ({
          check: i.checkNumber,
          payee: i.payeeName,
          amount: i.amount.formatted,
          ageDays: i.ageDays,
          state: i.ownerState,
          status: i.status,
          needsReview: i.needsReview,
          nextDeadline: i.nextDeadline,
          dependsOnUnverified: i.dependsOnUnverified,
        })),
      },
      ui: { kind: "items", props: { asOf: r.asOf, total, items, filters } },
    };
  },
});

export const explainItemTool = defineTool({
  name: "explain_item",
  label: "Tracing the legal timeline",
  description:
    "Explains one stale item end to end: payee, ledger entry, every legal date (presumed abandoned, due-diligence window, report due, " +
    "remit due) with rule path, rule version, official source URLs and a verified flag per date, plus outreach, approvals and agent runs. " +
    "Accepts a check number (e.g. '10482' or '#10482') or an item id. Use for 'explain check #10482' or 'why is this due then?'.",
  input: z.object({ item: ITEM_REF }),
  writes: false,
  async run(ctx, { item }) {
    const id = await findStaleItemId(ctx.db, ctx.companyId, normalizeItemRef(item));
    const e = id ? await explainItem(ctx.db, id) : null;
    if (!e) throw new ChatToolError(`No stale item found for "${item}". Try list_stale_items with a search term.`);
    return {
      summary: `${e.item.payeeName}, ${e.item.amount.formatted}`,
      data: {
        asOf: e.asOf,
        item: {
          id: e.item.id,
          check: e.item.checkNumber,
          payee: e.item.payeeName,
          amount: e.item.amount.formatted,
          issueDate: e.item.issueDate,
          ageDays: e.item.ageDays,
          ownerState: e.item.ownerState,
          ownerStateBasis: e.item.ownerStateBasis,
          status: e.item.status,
          ruleVersion: e.item.ruleVersion,
        },
        rules: e.rules,
        timeline: e.timeline.map((t) => ({
          event: t.label,
          date: t.date,
          status: t.status === "unknown" ? "UNKNOWN" : t.status,
          verified: t.verified,
          flag: t.status === "unknown" ? "UNKNOWN" : t.verified ? null : "UNVERIFIED",
          ruleVersion: t.ruleVersion,
          rulePaths: t.rulePaths,
          sources: t.sources.map((s) => s.url),
          notes: t.notes,
          // Plain-English derivation computed by the rules engine (code); the model may quote it, never alter it.
          derivation: t.derivation,
          roll: t.roll,
        })),
        warnings: e.warnings,
        outreach: e.outreach.map((o) => ({ channel: o.channel, status: o.status, sentAt: o.sentAt })),
        approvals: e.approvals.length,
      },
      ui: { kind: "item_timeline", props: { explanation: e } },
    };
  },
});

export const upcomingDeadlinesTool = defineTool({
  name: "upcoming_deadlines",
  label: "Checking upcoming deadlines",
  description:
    "Lists compliance deadlines (due-diligence window start/end, report due, remit due) between today (the app's demo clock) and N days " +
    "ahead (default 90), sorted by date, each with item, owner state and whether it rests on a verified rule.",
  input: z.object({ days: z.number().int().min(1).max(730).optional().describe("Look-ahead window in days; default 90") }),
  writes: false,
  async run(ctx, { days }) {
    const d = await upcomingDeadlines(ctx.db, ctx.companyId, days ?? 90);
    const unverified = d.events.filter((e) => !e.verified).length;
    return {
      summary: `${plural(d.events.length, "deadline")} in ${plural(d.days, "day")}`,
      data: {
        asOf: d.asOf,
        days: d.days,
        count: d.events.length,
        unverifiedCount: unverified,
        events: d.events.slice(0, 60).map((e) => ({
          date: e.date,
          kind: e.kind,
          daysUntil: e.daysUntil,
          verified: e.verified,
          check: e.checkNumber,
          payee: e.payeeName,
          state: e.state,
          amount: e.amount.formatted,
        })),
      },
      ui: { kind: "deadlines", props: d },
    };
  },
});

const UNKNOWN_ITEMS_CAP = 20;

export const getForecastTool = defineTool({
  name: "get_forecast",
  label: "Projecting liability by month",
  description:
    "Forecasts the next N months (default 18) from today (the app's demo clock), per owner state and calendar month: amounts of open " +
    "items that become presumed abandoned, due-diligence windows opening, report due dates and remittances due, all computed by the " +
    "deterministic rules engine. Items whose rule value is missing are returned in an explicit UNKNOWN bucket and are never placed in a " +
    "month; months resting on unverified rules are flagged. Use for 'what will we owe over the next year?' or 'when do filings land?'.",
  input: z.object({
    state: STATE.optional(),
    horizon_months: z
      .number()
      .int()
      .min(MIN_HORIZON_MONTHS)
      .max(MAX_HORIZON_MONTHS)
      .optional()
      .describe(`Months to look ahead, ${MIN_HORIZON_MONTHS}-${MAX_HORIZON_MONTHS}; default ${DEFAULT_HORIZON_MONTHS}`),
  }),
  writes: false,
  async run(ctx, { state, horizon_months }) {
    const f = await getForecast(ctx.db, ctx.companyId, { horizonMonths: horizon_months, states: state ? [state] : undefined });
    const months: ForecastUi["props"]["months"] = f.months.map((m) => ({
      month: m.month,
      presumedCents: m.presumedCents,
      presumedCount: m.presumedCount,
      remitCents: m.remitCents,
      remitCount: m.remitCount,
      ddOpenCount: m.counts.dd_window_opens,
      reportDueCount: m.counts.report_due,
      anyUnverified: m.anyUnverified,
      byState: m.byState.map((c) => ({ state: c.state, presumedCents: c.presumedCents, remitCents: c.remitCents, unverified: c.unverified })),
    }));
    const unknownItems = f.unknown.items.map((u) => ({
      itemId: u.itemId,
      checkNumber: u.checkNumber,
      payeeName: u.payeeName,
      state: u.state,
      amountCents: u.amountCents,
      missing: u.missing,
    }));
    return {
      summary: `${formatUSD(f.totals.presumedCents)} becoming abandoned over ${f.horizonMonths} months${state ? ` in ${state}` : ""}; ${f.unknown.count} unknown`,
      data: {
        asOf: f.asOf,
        horizonMonths: f.horizonMonths,
        windowEndExclusive: f.windowEnd,
        states: f.states,
        totals: {
          presumedAbandoned: formatUSD(f.totals.presumedCents),
          presumedCount: f.totals.presumedCount,
          dueToRemit: formatUSD(f.totals.remitCents),
          remitCount: f.totals.remitCount,
          unverifiedEvents: f.totals.unverifiedEvents,
        },
        months: f.months
          .filter((m) => m.events.length > 0)
          .map((m) => ({
            month: m.month,
            unverified: m.anyUnverified,
            byState: m.byState.map((c) => ({
              state: c.state,
              presumedAbandoned: c.presumedCount ? `${formatUSD(c.presumedCents)} (${c.presumedCount})` : null,
              ddWindowsOpen: c.ddOpenDates.length ? c.ddOpenDates : null,
              reportDue: c.reportDue.length ? c.reportDue.map((r) => ({ date: r.date, stage: r.stage, items: r.count })) : null,
              remitDue: c.remitCount ? { dates: c.remitDueDates, amount: formatUSD(c.remitCents), items: c.remitCount } : null,
              unverified: c.unverified,
            })),
          })),
        unknown: {
          note: "Rule value missing: these items' dates are UNKNOWN and are not counted in any month.",
          count: f.unknown.count,
          total: formatUSD(f.unknown.cents),
          items: f.unknown.items.slice(0, UNKNOWN_ITEMS_CAP).map((u) => ({ check: u.checkNumber, payee: u.payeeName, state: u.state, amount: formatUSD(u.amountCents), missing: u.missing, reasons: u.reasons })),
        },
      },
      ui: {
        kind: "forecast",
        props: {
          asOf: f.asOf,
          horizonMonths: f.horizonMonths,
          state: state ?? null,
          states: f.states,
          months,
          totals: f.totals,
          unknown: { count: f.unknown.count, cents: f.unknown.cents, items: unknownItems.slice(0, UNKNOWN_ITEMS_CAP) },
        },
      },
    };
  },
});

export const auditInterestTool = defineTool({
  name: "get_audit_interest_exposure",
  label: "Estimating audit interest",
  description:
    "Estimates interest the company could owe per state if open items were reported late, computed deterministically from each state's " +
    "interest rule. Always an ESTIMATE, labeled unverified when the rule is unverified; null/UNKNOWN when a rule or due date is missing.",
  input: z.object({}),
  writes: false,
  async run(ctx) {
    const r = await getAuditInterestExposure(ctx.db, ctx.companyId);
    return {
      summary: `${r.label}: ${r.total ? formatUSD(r.total.cents) : "UNKNOWN"}`,
      data: {
        asOf: r.asOf,
        label: r.label,
        total: r.total?.formatted ?? "UNKNOWN",
        anyUnknown: r.anyUnknown,
        anyUnverified: r.anyUnverified,
        byState: r.byState.map((s) => ({
          state: s.state,
          items: s.itemCount,
          principal: s.principal.formatted,
          interest: s.interest?.formatted ?? "UNKNOWN",
          verified: s.verified,
          label: s.label,
          notes: s.notes,
        })),
      },
      ui: { kind: "interest", props: { interest: r } },
    };
  },
});
