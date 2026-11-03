/**
 * Money flow (DESIGN-V3 §4.2): where every ledger dollar is right now, as Sankey nodes and links. Built from real rows
 * only: `ledger_items` (cleared or voided vs outstanding), `stale_items` (by owner state and status) and `recoveries`
 * (by status). Nothing is estimated or back-filled.
 *
 * Columns, left to right:
 *   Ledger → {Cleared or voided, Not yet stale, Stale}
 *   Stale  → {Resolved with owner, Reported, Remitted, At risk: CA / DE / TX / …}
 *   At risk: ST → {Watching, In due diligence, Needs rule, Ready to report}
 * plus a separate reverse band: State portals → {Recovered to you, Claims in progress}.
 *
 * Deviation from the spec's column order (noted in the slice report): the spec puts the state split only on
 * "Reportable". Splitting every open item by state first makes each "At risk: ST" node equal the Money Map column for
 * that state and the sum of them equal the dashboard total (`getExposure`), and keeps every middle node conserved
 * (incoming cents == outgoing cents), which the spec's own conservation test requires.
 *
 * If the ledger is incomplete (no cleared or voided rows were ingested, so the ledger total is not known), the diagram
 * starts at Stale and `startsAt` says so.
 */
import { and, count, eq, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, recoveries, staleItems } from "@/db/schema";
import { addDays, type IsoDate } from "@/lib/dates";
import { today } from "./common";

export const FLOW_URGENT_DAYS = 7;

export type FlowNodeKind = "ledger" | "cleared" | "notStale" | "stale" | "closed" | "state" | "status" | "portal" | "recovered" | "claims";

export interface FlowNode {
  id: string;
  label: string;
  /** Sankey column (0-based). The recovery band has its own columns 0..1. */
  column: number;
  cents: number;
  count: number;
  kind: FlowNodeKind;
  band: "main" | "recovery";
  /** Owner state for "At risk: ST" nodes. */
  state?: string;
  /** Filtered list this node opens. */
  href?: string;
  /** A person is needed for money arriving here (an incoming link needs you). */
  needsYou: boolean;
  /** Items here whose dates rest on an unverified rule value. */
  unverified: number;
}

export interface FlowLink {
  source: string;
  target: string;
  cents: number;
  count: number;
  band: "main" | "recovery";
  /** "human" = pink (approval pending or a deadline within 7 days); "recovered" = blue-300. */
  tone: "default" | "human" | "recovered";
}

export interface FlowAmount {
  cents: number;
  count: number;
}

export interface MoneyFlow {
  asOf: IsoDate;
  startsAt: "ledger" | "stale";
  nodes: FlowNode[];
  links: FlowLink[];
  /** Open, unfiled stale items: equals getExposure().totalCents / itemCount. */
  exposure: FlowAmount;
  /** Per owner state, open and unfiled (the Money Map columns). */
  byState: { state: string; cents: number; count: number; unverified: number; urgent: number }[];
  /** recoveries with status `paid`; null when there are none (never zero-filled). */
  recovered: FlowAmount | null;
  /** recoveries found through claim_submitted; null when there are none. */
  claimsInProgress: FlowAmount | null;
  recoveredByState: { state: string; cents: number; count: number }[];
}

/* ------------------------------------------------------------------ pure builder (unit tested) */

export type StaleStatus = "watching" | "dd_pending" | "dd_sent" | "owner_responded" | "resolved_paid" | "to_report" | "reported" | "remitted" | "needs_rule";
export type RecoveryStatus = "found" | "claim_drafted" | "awaiting_approval" | "claim_submitted" | "paid" | "rejected";

export interface FlowInput {
  asOf: IsoDate;
  /** Ledger rows bucketed once each: an item with a stale record is "stale" whatever its ledger status. */
  ledger: { stale: FlowAmount; notStale: FlowAmount; cleared: FlowAmount };
  stale: { state: string | null; status: StaleStatus; cents: number; count: number; urgent: number; awaiting: number; unverified: number }[];
  recoveries: { state: string; status: RecoveryStatus; cents: number; count: number }[];
}

const UNKNOWN_STATE = "UNKNOWN";

/** Open status → the node it flows into. Open = everything getExposure counts. */
const OPEN_GROUP: Partial<Record<StaleStatus, { id: string; label: string; href: string }>> = {
  watching: { id: "watching", label: "Watching", href: "/items?status=watching" },
  dd_pending: { id: "dd", label: "In due diligence", href: "/items?status=dd_pending" },
  dd_sent: { id: "dd", label: "In due diligence", href: "/items?status=dd_pending" },
  owner_responded: { id: "dd", label: "In due diligence", href: "/items?status=dd_pending" },
  needs_rule: { id: "needs_rule", label: "Needs rule", href: "/items?status=needs_rule" },
  to_report: { id: "to_report", label: "Ready to report", href: "/items?status=to_report" },
};
const CLOSED_GROUP: Partial<Record<StaleStatus, { id: string; label: string; href: string }>> = {
  resolved_paid: { id: "resolved", label: "Resolved with owner", href: "/items?status=resolved_paid" },
  reported: { id: "reported", label: "Reported", href: "/items?status=reported" },
  remitted: { id: "remitted", label: "Remitted", href: "/items?status=remitted" },
};
const CLAIM_STATUSES: readonly RecoveryStatus[] = ["found", "claim_drafted", "awaiting_approval", "claim_submitted"];
/** Display order of the open-status column (top to bottom). */
const STATUS_ORDER = ["to_report", "dd", "needs_rule", "watching"];
const CLOSED_ORDER = ["resolved", "reported", "remitted"];

const stateLabel = (s: string) => (s === UNKNOWN_STATE ? "At risk: state unknown" : `At risk: ${s}`);

/** Pure: turn grouped rows into nodes and links. Zero links are dropped; nodes without links are dropped. */
export function buildMoneyFlow(input: FlowInput): MoneyFlow {
  const startsAt: MoneyFlow["startsAt"] = input.ledger.cleared.count > 0 ? "ledger" : "stale";
  const off = startsAt === "ledger" ? 1 : 0;
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();

  const node = (n: Omit<FlowNode, "cents" | "count" | "needsYou" | "unverified">) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, cents: 0, count: 0, needsYou: false, unverified: 0 });
    return nodes.get(n.id)!;
  };
  const link = (source: string, target: string, cents: number, n: number, band: FlowLink["band"], tone: FlowLink["tone"] = "default") => {
    if (cents <= 0 || n <= 0) return;
    const key = `${source}→${target}`;
    const prev = links.get(key);
    links.set(key, prev ? { ...prev, cents: prev.cents + cents, count: prev.count + n, tone: prev.tone === "human" ? "human" : tone } : { source, target, cents, count: n, band, tone });
  };

  // Column 0/1: the ledger.
  if (startsAt === "ledger") {
    node({ id: "ledger", label: "Ledger", column: 0, kind: "ledger", band: "main", href: "/items" });
    node({ id: "cleared", label: "Cleared or voided", column: 1, kind: "cleared", band: "main" });
    node({ id: "not_stale", label: "Not yet stale", column: 1, kind: "notStale", band: "main" });
    link("ledger", "cleared", input.ledger.cleared.cents, input.ledger.cleared.count, "main");
    link("ledger", "not_stale", input.ledger.notStale.cents, input.ledger.notStale.count, "main");
  }
  node({ id: "stale", label: "Stale", column: off, kind: "stale", band: "main", href: "/items" });

  const byState = new Map<string, MoneyFlow["byState"][number]>();
  let staleCents = 0;
  let staleCount = 0;
  for (const r of input.stale) {
    if (r.cents < 0 || r.count <= 0) continue;
    staleCents += r.cents;
    staleCount += r.count;
    const closed = CLOSED_GROUP[r.status];
    if (closed) {
      node({ id: closed.id, label: closed.label, column: off + 1, kind: "closed", band: "main", href: closed.href });
      link("stale", closed.id, r.cents, r.count, "main");
      continue;
    }
    const group = OPEN_GROUP[r.status];
    if (!group) continue;
    const st = r.state ?? UNKNOWN_STATE;
    const sid = `state:${st}`;
    const human = r.urgent > 0 || (group.id === "dd" && r.awaiting > 0);
    const sn = node({
      id: sid,
      label: stateLabel(st),
      column: off + 1,
      kind: "state",
      band: "main",
      state: st,
      href: st === UNKNOWN_STATE ? "/items" : `/items?state=${st}`,
    });
    sn.unverified += r.unverified;
    const gn = node({ id: group.id, label: group.label, column: off + 2, kind: "status", band: "main", href: group.href });
    gn.unverified += r.unverified;
    link("stale", sid, r.cents, r.count, "main");
    link(sid, group.id, r.cents, r.count, "main", human && group.id !== "watching" ? "human" : "default");
    const agg = byState.get(st) ?? { state: st, cents: 0, count: 0, unverified: 0, urgent: 0 };
    byState.set(st, { ...agg, cents: agg.cents + r.cents, count: agg.count + r.count, unverified: agg.unverified + r.unverified, urgent: agg.urgent + r.urgent });
  }
  if (startsAt === "ledger") link("ledger", "stale", staleCents, staleCount, "main");

  // Recovery band (reverse, drawn from the right edge): only rows that exist.
  const rec: FlowAmount = { cents: 0, count: 0 };
  const claim: FlowAmount = { cents: 0, count: 0 };
  const recoveredByState = new Map<string, { state: string; cents: number; count: number }>();
  for (const r of input.recoveries) {
    if (r.cents <= 0 || r.count <= 0) continue;
    if (r.status === "paid") {
      node({ id: "portals", label: "State portals", column: 0, kind: "portal", band: "recovery", href: "/recoveries" });
      node({ id: "recovered", label: "Recovered to you", column: 1, kind: "recovered", band: "recovery", href: "/recoveries" });
      link("portals", "recovered", r.cents, r.count, "recovery", "recovered");
      rec.cents += r.cents;
      rec.count += r.count;
      const p = recoveredByState.get(r.state) ?? { state: r.state, cents: 0, count: 0 };
      recoveredByState.set(r.state, { ...p, cents: p.cents + r.cents, count: p.count + r.count });
    } else if (CLAIM_STATUSES.includes(r.status)) {
      node({ id: "portals", label: "State portals", column: 0, kind: "portal", band: "recovery", href: "/recoveries" });
      node({ id: "claims", label: "Claims in progress", column: 1, kind: "claims", band: "recovery", href: "/recoveries" });
      link("portals", "claims", r.cents, r.count, "recovery", r.status === "awaiting_approval" ? "human" : "default");
      claim.cents += r.cents;
      claim.count += r.count;
    }
  }

  const linkList = [...links.values()];
  // Node totals: max(incoming, outgoing), which for a conserved middle node is both.
  for (const n of nodes.values()) {
    const inc = linkList.filter((l) => l.target === n.id);
    const out = linkList.filter((l) => l.source === n.id);
    const sumC = (ls: FlowLink[]) => ls.reduce((a, l) => a + l.cents, 0);
    const sumN = (ls: FlowLink[]) => ls.reduce((a, l) => a + l.count, 0);
    n.cents = Math.max(sumC(inc), sumC(out));
    n.count = Math.max(sumN(inc), sumN(out));
    n.needsYou = inc.some((l) => l.tone === "human");
  }
  const used = new Set(linkList.flatMap((l) => [l.source, l.target]));
  const order = (n: FlowNode) => {
    if (n.kind === "status") return STATUS_ORDER.indexOf(n.id);
    if (n.kind === "closed") return 10 + CLOSED_ORDER.indexOf(n.id);
    if (n.kind === "state") return -n.cents / 1e12; // largest state first, above the closed buckets
    return 0;
  };
  const nodeList = [...nodes.values()].filter((n) => used.has(n.id)).sort((a, b) => a.column - b.column || order(a) - order(b) || a.id.localeCompare(b.id));
  const states = [...byState.values()].sort((a, b) => b.cents - a.cents || a.state.localeCompare(b.state));
  return {
    asOf: input.asOf,
    startsAt,
    nodes: nodeList,
    links: linkList,
    exposure: { cents: states.reduce((a, s) => a + s.cents, 0), count: states.reduce((a, s) => a + s.count, 0) },
    byState: states,
    recovered: rec.count > 0 ? rec : null,
    claimsInProgress: claim.count > 0 ? claim : null,
    recoveredByState: [...recoveredByState.values()].sort((a, b) => b.cents - a.cents),
  };
}

/* ------------------------------------------------------------------ query */

const num = (v: unknown) => Number(v ?? 0);

export async function getMoneyFlow(db: Db, companyId: string): Promise<MoneyFlow> {
  const asOf = await today(db, companyId);
  const soon = addDays(asOf, FLOW_URGENT_DAYS);
  // Earliest of the item's action deadlines (including ones already missed) falls within the next 7 days.
  const urgentSql = sql`least(${staleItems.ddWindowEnd}, ${staleItems.reportDueDate}, ${staleItems.remitDueDate}) <= ${soon}`;
  const awaitingSql = sql`exists (select 1 from ${outreach} where ${outreach.staleItemId} = ${staleItems.id} and ${outreach.status} = 'awaiting_approval')`;
  const bucket = sql<string>`case when ${staleItems.id} is not null then 'stale' when ${ledgerItems.status} = 'outstanding' then 'not_stale' else 'cleared' end`;

  const [ledgerRows, staleRows, recoveryRows] = await Promise.all([
    db
      .select({ bucket, cents: sql<string>`sum(coalesce(${staleItems.amountCents}, ${ledgerItems.amountCents}))`, n: count() })
      .from(ledgerItems)
      .leftJoin(staleItems, eq(staleItems.ledgerItemId, ledgerItems.id))
      .where(eq(ledgerItems.companyId, companyId))
      .groupBy(bucket),
    db
      .select({
        state: staleItems.ownerState,
        status: staleItems.status,
        cents: sum(staleItems.amountCents),
        n: count(),
        urgent: sql<number>`count(*) filter (where ${urgentSql})`,
        awaiting: sql<number>`count(*) filter (where ${awaitingSql})`,
        unverified: sql<number>`count(*) filter (where ${staleItems.dependsOnUnverified} or ${staleItems.status} = 'needs_rule')`,
      })
      .from(staleItems)
      .where(eq(staleItems.companyId, companyId))
      .groupBy(staleItems.ownerState, staleItems.status),
    db
      .select({ state: recoveries.state, status: recoveries.status, cents: sum(recoveries.amountCents), n: count() })
      .from(recoveries)
      .where(and(eq(recoveries.companyId, companyId)))
      .groupBy(recoveries.state, recoveries.status),
  ]);

  const amt = (b: string): FlowAmount => {
    const r = ledgerRows.find((x) => x.bucket === b);
    return { cents: num(r?.cents), count: num(r?.n) };
  };
  return buildMoneyFlow({
    asOf,
    ledger: { stale: amt("stale"), notStale: amt("not_stale"), cleared: amt("cleared") },
    stale: staleRows.map((r) => ({
      state: r.state,
      status: r.status,
      cents: num(r.cents),
      count: num(r.n),
      urgent: num(r.urgent),
      awaiting: num(r.awaiting),
      unverified: num(r.unverified),
    })),
    recoveries: recoveryRows.map((r) => ({ state: r.state, status: r.status, cents: num(r.cents), count: num(r.n) })),
  });
}
