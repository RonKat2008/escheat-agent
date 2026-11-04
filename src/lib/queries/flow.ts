/**
 * Money flow (DESIGN-V3 §4.2, rebuilt for dogfood R4-07/R4-08): where the stale money is right now, as Sankey nodes and
 * links. Built from real rows only: `ledger_items` (for the one-line ledger caption), `stale_items` (by owner state and
 * status), the shared overdue assessment (getOverdue, for the Late band) and `recoveries`. Nothing is estimated.
 *
 * Columns, left to right (the diagram starts at Stale; the ledger split is a caption, not a block that dwarfs the rest):
 *   Stale       → {At risk: CA / DE / TX / …, Resolved with owner, Reported, Remitted}
 *   At risk: ST → {Late, Ready to report, In due diligence, Needs rule, Watching}
 * plus a separate band: State portals → {Recovered to you, Claims in progress}.
 *
 * "Late" carves the overdue items (src/lib/overdue.ts via getOverdue) out of their status band, so every middle node
 * stays conserved and the "At risk" states still add up to getExposure. The late-report interest rides on the Late node
 * as a label (it is not stale principal, so it never widens a band).
 */
import { and, count, eq, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, outreachItems, recoveries, staleItems } from "@/db/schema";
import { addDays, type IsoDate } from "@/lib/dates";
import type { ItemStatus } from "@/lib/overdue";
import { pendingDeadlinesOf, today, type DateColumns } from "./common";

export const FLOW_URGENT_DAYS = 7;

export type FlowNodeKind = "stale" | "closed" | "state" | "status" | "late" | "portal" | "recovered" | "claims";

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
  /**
   * "late" = pink (past a deadline); "human" = pink (a deadline within 7 days or a letter awaiting approval);
   * "recovered" = blue-300.
   */
  tone: "default" | "human" | "late" | "recovered";
  /** The Items list this band opens (deep link with the closest filters Items supports). */
  href: string;
  /**
   * Items the href's list also shows that are not in this band: the late items of the same state and status (Items has
   * no "not overdue" filter). 0 when the list is exact.
   */
  alsoListed: number;
}

export interface FlowAmount {
  cents: number;
  count: number;
}

export interface LateInterest {
  /** Simple late-report interest from the rules engine; null when no state with a late report has a usable rule. */
  cents: number | null;
  verified: boolean;
  /** States with a late report and no usable interest rule (named, never given a rate). */
  unknownStates: string[];
}

export interface MoneyFlow {
  asOf: IsoDate;
  /** The ledger split, for the caption. `known` is false when no cleared or voided rows were imported. */
  ledger: { known: boolean; total: FlowAmount; cleared: FlowAmount; notStale: FlowAmount; stale: FlowAmount };
  nodes: FlowNode[];
  links: FlowLink[];
  /** Open, unfiled stale items: equals getExposure().totalCents / itemCount. */
  exposure: FlowAmount;
  /**
   * Every item past a deadline (the Late band), with the interest on exactly these items; null when nothing is late.
   * Equals getOverdue() count and total. `remitLate` is the part already reported whose remittance date passed.
   */
  late: (FlowAmount & { remitLate: FlowAmount; interest: LateInterest | null }) | null;
  /** Per owner state, open and unfiled (the Money Map columns). `late` = overdue; `urgent` = due within 7 days. */
  byState: { state: string; cents: number; count: number; unverified: number; urgent: number; late: number }[];
  /** recoveries with status `paid`; null when there are none (never zero-filled). */
  recovered: FlowAmount | null;
  /** recoveries found through claim_submitted; null when there are none. */
  claimsInProgress: FlowAmount | null;
  recoveredByState: { state: string; cents: number; count: number }[];
}

/* ------------------------------------------------------------------ pure builder (unit tested) */

export type StaleStatus = "watching" | "dd_pending" | "dd_sent" | "owner_responded" | "resolved_paid" | "to_report" | "reported" | "remitted" | "needs_rule";
export type RecoveryStatus = "found" | "claim_drafted" | "awaiting_approval" | "claim_submitted" | "paid" | "rejected";

/** Overdue items, grouped by owner state and status (see lateRows). */
export interface LateRow {
  state: string | null;
  status: string;
  cents: number;
  count: number;
}

export interface FlowInput {
  asOf: IsoDate;
  /** Ledger rows bucketed once each: an item with a stale record is "stale" whatever its ledger status. */
  ledger: { stale: FlowAmount; notStale: FlowAmount; cleared: FlowAmount };
  /**
   * `urgent` = the next deadline still owed in the item's status falls within 7 days, today included (pendingUrgent);
   * `awaiting` = has a letter awaiting approval.
   */
  stale: { state: string | null; status: StaleStatus; cents: number; count: number; urgent: number; awaiting: number; unverified: number }[];
  recoveries: { state: string; status: RecoveryStatus; cents: number; count: number }[];
  late?: LateRow[];
  lateInterest?: LateInterest | null;
}

const UNKNOWN_STATE = "UNKNOWN";

/** Open status → the node it flows into. Open = everything getExposure counts. */
const OPEN_GROUP: Partial<Record<StaleStatus, { id: string; label: string }>> = {
  watching: { id: "watching", label: "Watching" },
  dd_pending: { id: "dd", label: "In due diligence" },
  dd_sent: { id: "dd", label: "In due diligence" },
  owner_responded: { id: "dd", label: "In due diligence" },
  needs_rule: { id: "needs_rule", label: "Needs rule" },
  to_report: { id: "to_report", label: "Ready to report" },
};
const CLOSED_GROUP: Partial<Record<StaleStatus, { id: string; label: string }>> = {
  resolved_paid: { id: "resolved", label: "Resolved with owner" },
  reported: { id: "reported", label: "Reported" },
  remitted: { id: "remitted", label: "Remitted" },
};
const CLAIM_STATUSES: readonly RecoveryStatus[] = ["found", "claim_drafted", "awaiting_approval", "claim_submitted"];
/** Display order of the open-status column (top to bottom): what needs a person first. */
const STATUS_ORDER = ["late", "to_report", "dd", "needs_rule", "watching"];
const CLOSED_ORDER = ["resolved", "reported", "remitted"];

const stateLabel = (s: string) => (s === UNKNOWN_STATE ? "At risk: state unknown" : `At risk: ${s}`);

/** Items deep link with only the filters /items understands: state (2 letters), one status, overdue. */
export function itemsHref(f: { state?: string | null; status?: string | null; overdue?: boolean }): string {
  const q = new URLSearchParams();
  if (f.state && f.state !== UNKNOWN_STATE) q.set("state", f.state);
  if (f.status) q.set("status", f.status);
  if (f.overdue) q.set("overdue", "1");
  const s = q.toString();
  return s ? `/items?${s}` : "/items";
}

interface LinkAcc extends FlowLink {
  statuses: ReadonlySet<string>;
  state?: string;
}

const isPink = (t: FlowLink["tone"]) => t === "human" || t === "late";

/** Pure: turn grouped rows into nodes and links. Zero links are dropped; nodes without links are dropped. */
export function buildMoneyFlow(input: FlowInput): MoneyFlow {
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, LinkAcc>();

  const node = (n: Omit<FlowNode, "cents" | "count" | "needsYou" | "unverified">) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, cents: 0, count: 0, needsYou: false, unverified: 0 });
    return nodes.get(n.id)!;
  };
  const link = (
    source: string,
    target: string,
    amt: FlowAmount,
    band: FlowLink["band"],
    tone: FlowLink["tone"],
    meta: { status?: string; state?: string; href: string; alsoListed?: number },
  ) => {
    if (amt.cents <= 0 || amt.count <= 0) return;
    const key = `${source}→${target}`;
    const prev = links.get(key);
    const statuses = new Set([...(prev?.statuses ?? []), ...(meta.status ? [meta.status] : [])]);
    links.set(
      key,
      prev
        ? {
            ...prev,
            cents: prev.cents + amt.cents,
            count: prev.count + amt.count,
            tone: isPink(prev.tone) ? prev.tone : tone,
            alsoListed: prev.alsoListed + (meta.alsoListed ?? 0),
            statuses,
          }
        : { source, target, cents: amt.cents, count: amt.count, band, tone, href: meta.href, alsoListed: meta.alsoListed ?? 0, statuses, state: meta.state },
    );
  };

  node({ id: "stale", label: "Stale", column: 0, kind: "stale", band: "main", href: "/items" });

  // Late (overdue) money per state+status, carved out of the status bands below.
  const lateBy = new Map<string, FlowAmount>();
  for (const l of input.late ?? []) {
    if (l.cents <= 0 || l.count <= 0) continue;
    const k = `${l.state ?? UNKNOWN_STATE}|${l.status}`;
    const p = lateBy.get(k) ?? { cents: 0, count: 0 };
    lateBy.set(k, { cents: p.cents + l.cents, count: p.count + l.count });
  }

  const byState = new Map<string, MoneyFlow["byState"][number]>();
  const late: FlowAmount & { remitLate: FlowAmount } = { cents: 0, count: 0, remitLate: { cents: 0, count: 0 } };
  for (const r of input.stale) {
    if (r.cents < 0 || r.count <= 0) continue;
    const closed = CLOSED_GROUP[r.status];
    if (closed) {
      node({ id: closed.id, label: closed.label, column: 1, kind: "closed", band: "main", href: itemsHref({ status: r.status }) });
      link("stale", closed.id, r, "main", "default", { href: itemsHref({ status: r.status }) });
      // R5-07: reported but the remittance date passed. Still late money (the Overdue panel counts it and its interest),
      // so it joins the Late band from Reported, never through "At risk" (which stays equal to the unfiled exposure).
      const remitLate = r.status === "reported" ? lateBy.get(`${r.state ?? UNKNOWN_STATE}|reported`) : undefined;
      if (remitLate) {
        const amt = { cents: Math.min(r.cents, remitLate.cents), count: Math.min(r.count, remitLate.count) };
        node({ id: "late", label: "Late", column: 2, kind: "late", band: "main", href: itemsHref({ overdue: true }) });
        link(closed.id, "late", amt, "main", "late", { status: r.status, href: itemsHref({ status: "reported", overdue: true }) });
        late.cents += amt.cents;
        late.count += amt.count;
        late.remitLate.cents += amt.cents;
        late.remitLate.count += amt.count;
      }
      continue;
    }
    const group = OPEN_GROUP[r.status];
    if (!group) continue;
    const st = r.state ?? UNKNOWN_STATE;
    const sid = `state:${st}`;
    const lr = lateBy.get(`${st}|${r.status}`);
    const lateAmt = { cents: Math.min(r.cents, lr?.cents ?? 0), count: Math.min(r.count, lr?.count ?? 0) };
    const sn = node({ id: sid, label: stateLabel(st), column: 1, kind: "state", band: "main", state: st, href: itemsHref({ state: st }) });
    sn.unverified += r.unverified;
    link("stale", sid, r, "main", "default", { href: itemsHref({ state: st }), state: st });

    const onTime = { cents: r.cents - lateAmt.cents, count: r.count - lateAmt.count };
    if (onTime.count > 0) {
      const gn = node({ id: group.id, label: group.label, column: 2, kind: "status", band: "main", href: itemsHref({ status: r.status }) });
      gn.unverified += r.unverified;
      // R5-07: pink = a person must act: a deadline still owed within 7 days (pendingUrgent) or a letter awaiting
      // approval, for every band. The caption states this rule, so the bands follow it with no exceptions.
      const human = r.urgent > 0 || r.awaiting > 0;
      link(sid, group.id, onTime, "main", human ? "human" : "default", {
        status: r.status,
        state: st,
        href: "",
        alsoListed: lateAmt.count,
      });
    }
    if (lateAmt.count > 0) {
      node({ id: "late", label: "Late", column: 2, kind: "late", band: "main", href: itemsHref({ overdue: true }) });
      link(sid, "late", lateAmt, "main", "late", { status: r.status, state: st, href: itemsHref({ state: st, overdue: true }) });
      late.cents += lateAmt.cents;
      late.count += lateAmt.count;
    }
    const agg = byState.get(st) ?? { state: st, cents: 0, count: 0, unverified: 0, urgent: 0, late: 0 };
    byState.set(st, {
      ...agg,
      cents: agg.cents + r.cents,
      count: agg.count + r.count,
      unverified: agg.unverified + r.unverified,
      urgent: agg.urgent + r.urgent,
      late: agg.late + lateAmt.count,
    });
  }

  // Recovery band: only rows that exist.
  const rec: FlowAmount = { cents: 0, count: 0 };
  const claim: FlowAmount = { cents: 0, count: 0 };
  const recoveredByState = new Map<string, { state: string; cents: number; count: number }>();
  for (const r of input.recoveries) {
    if (r.cents <= 0 || r.count <= 0) continue;
    if (r.status === "paid") {
      node({ id: "portals", label: "State portals", column: 0, kind: "portal", band: "recovery", href: "/recoveries" });
      node({ id: "recovered", label: "Recovered to you", column: 1, kind: "recovered", band: "recovery", href: "/recoveries" });
      link("portals", "recovered", r, "recovery", "recovered", { href: "/recoveries" });
      rec.cents += r.cents;
      rec.count += r.count;
      const p = recoveredByState.get(r.state) ?? { state: r.state, cents: 0, count: 0 };
      recoveredByState.set(r.state, { ...p, cents: p.cents + r.cents, count: p.count + r.count });
    } else if (CLAIM_STATUSES.includes(r.status)) {
      node({ id: "portals", label: "State portals", column: 0, kind: "portal", band: "recovery", href: "/recoveries" });
      node({ id: "claims", label: "Claims in progress", column: 1, kind: "claims", band: "recovery", href: "/recoveries" });
      link("portals", "claims", r, "recovery", r.status === "awaiting_approval" ? "human" : "default", { href: "/recoveries" });
      claim.cents += r.cents;
      claim.count += r.count;
    }
  }

  // Status-band hrefs: one status → state+status; the DD group spanning several statuses → the state only.
  const linkList: FlowLink[] = [...links.values()].map(({ statuses, state, ...l }) => {
    if (l.href) return l;
    const only = statuses.size === 1 ? [...statuses][0]! : null;
    return { ...l, href: itemsHref({ state, status: only }) };
  });
  // Node totals: max(incoming, outgoing), which for a conserved middle node is both.
  const sumC = (ls: FlowLink[]) => ls.reduce((a, l) => a + l.cents, 0);
  const sumN = (ls: FlowLink[]) => ls.reduce((a, l) => a + l.count, 0);
  for (const n of nodes.values()) {
    const inc = linkList.filter((l) => l.target === n.id);
    const out = linkList.filter((l) => l.source === n.id);
    n.cents = Math.max(sumC(inc), sumC(out));
    n.count = Math.max(sumN(inc), sumN(out));
    n.needsYou = inc.some((l) => isPink(l.tone));
  }
  const used = new Set(linkList.flatMap((l) => [l.source, l.target]));
  const order = (n: FlowNode) => {
    if (n.kind === "status" || n.kind === "late") return STATUS_ORDER.indexOf(n.id);
    if (n.kind === "closed") return 10 + CLOSED_ORDER.indexOf(n.id);
    if (n.kind === "state") return -n.cents / 1e12; // largest state first, above the closed buckets
    return 0;
  };
  const nodeList = [...nodes.values()].filter((n) => used.has(n.id)).sort((a, b) => a.column - b.column || order(a) - order(b) || a.id.localeCompare(b.id));
  const states = [...byState.values()].sort((a, b) => b.cents - a.cents || a.state.localeCompare(b.state));
  const { stale, notStale, cleared } = input.ledger;
  return {
    asOf: input.asOf,
    ledger: {
      known: cleared.count > 0,
      total: { cents: stale.cents + notStale.cents + cleared.cents, count: stale.count + notStale.count + cleared.count },
      cleared,
      notStale,
      stale,
    },
    nodes: nodeList,
    links: linkList,
    exposure: { cents: states.reduce((a, s) => a + s.cents, 0), count: states.reduce((a, s) => a + s.count, 0) },
    late: late.count > 0 ? { cents: late.cents, count: late.count, remitLate: late.remitLate, interest: input.lateInterest ?? null } : null,
    byState: states,
    recovered: rec.count > 0 ? rec : null,
    claimsInProgress: claim.count > 0 ? claim : null,
    recoveredByState: [...recoveredByState.values()].sort((a, b) => b.cents - a.cents),
  };
}

/**
 * What the pink means, built only from the bands actually on screen (R4-08, R5-07): each clause appears only when a
 * band of that kind is drawn, so the sentence never names a band that is not there.
 */
export function pinkCaptionText(flow: Pick<MoneyFlow, "links">): string {
  const late = flow.links.some((l) => l.tone === "late");
  const human = flow.links.some((l) => l.tone === "human");
  if (!late && !human) return "Nothing needs a person right now, so no band is pink.";
  const soon = "a deadline within 7 days or a letter awaiting approval";
  if (late && human) return `Pink needs a person: Late is past a filing, remittance or due-diligence deadline; the other pink bands have ${soon}.`;
  if (late) return "Pink needs a person: Late is past a filing, remittance or due-diligence deadline.";
  return `Pink needs a person: those bands have ${soon}.`;
}

/** Group overdue items (getOverdue().items) into LateRows. */
export function lateRows(items: readonly { state: string | null; status: string; amount: { cents: number } }[]): LateRow[] {
  const m = new Map<string, LateRow>();
  for (const i of items) {
    const k = `${i.state ?? ""}|${i.status}`;
    const p = m.get(k) ?? { state: i.state, status: i.status, cents: 0, count: 0 };
    m.set(k, { ...p, cents: p.cents + i.amount.cents, count: p.count + 1 });
  }
  return [...m.values()];
}

/**
 * R5-07: "due soon" means the next deadline the item still owes in its status (a to_report item no longer owes its
 * closed DD window) falls between today and today + 7 days. A missed one is the Late band's, never "soon". Same
 * pending-deadline rule as Items' next deadline (nextDeadline in ./common), so the two never disagree. The opening of
 * a DD window is not a deadline.
 */
export function pendingUrgent(row: DateColumns & { status: StaleStatus }, asOf: IsoDate, days = FLOW_URGENT_DAYS): boolean {
  const soon = addDays(asOf, days);
  return pendingDeadlinesOf(row, row.status as ItemStatus).some((d) => d.kind !== "dd_window_start" && d.date >= asOf && d.date <= soon);
}

export interface StaleFlowRow extends DateColumns {
  state: string | null;
  status: StaleStatus;
  cents: number;
  awaiting: boolean | null;
  unverified: boolean | null;
}

/** Group item rows by (state, status) with their urgent / awaiting / unverified counts. */
export function groupStaleRows(rows: readonly StaleFlowRow[], asOf: IsoDate): FlowInput["stale"] {
  const m = new Map<string, FlowInput["stale"][number]>();
  for (const r of rows) {
    const k = `${r.state ?? ""}|${r.status}`;
    const p = m.get(k) ?? { state: r.state, status: r.status, cents: 0, count: 0, urgent: 0, awaiting: 0, unverified: 0 };
    m.set(k, {
      ...p,
      cents: p.cents + num(r.cents),
      count: p.count + 1,
      urgent: p.urgent + (pendingUrgent(r, asOf) ? 1 : 0),
      awaiting: p.awaiting + (r.awaiting ? 1 : 0),
      unverified: p.unverified + (r.unverified ? 1 : 0),
    });
  }
  return [...m.values()];
}

/* ------------------------------------------------------------------ query */

const num = (v: unknown) => Number(v ?? 0);

export async function getMoneyFlow(
  db: Db,
  companyId: string,
  opts: { late?: LateRow[]; lateInterest?: LateInterest | null } = {},
): Promise<MoneyFlow> {
  const asOf = await today(db, companyId);
  // A letter awaiting approval: a composed draft or one sent for approval (the queue Approvals shows and the dashboard
  // counts as "drafts awaiting approval"; R4-08). One-notice-per-owner letters link items through outreach_items; older
  // rows through outreach.stale_item_id.
  const awaitingSql = sql`exists (select 1 from ${outreach} where ${outreach.status} in ('draft', 'awaiting_approval') and (${outreach.staleItemId} = ${staleItems.id} or exists (select 1 from ${outreachItems} where ${outreachItems.outreachId} = ${outreach.id} and ${outreachItems.staleItemId} = ${staleItems.id})))`;
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
        cents: staleItems.amountCents,
        ddWindowStart: staleItems.ddWindowStart,
        ddWindowEnd: staleItems.ddWindowEnd,
        reportDueDate: staleItems.reportDueDate,
        remitDueDate: staleItems.remitDueDate,
        awaiting: sql<boolean>`${awaitingSql}`,
        unverified: sql<boolean>`(${staleItems.dependsOnUnverified} or ${staleItems.status} = 'needs_rule')`,
      })
      .from(staleItems)
      .where(eq(staleItems.companyId, companyId)),
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
    stale: groupStaleRows(staleRows, asOf),
    recoveries: recoveryRows.map((r) => ({ state: r.state, status: r.status, cents: num(r.cents), count: num(r.n) })),
    late: opts.late ?? [],
    lateInterest: opts.lateInterest ?? null,
  });
}
