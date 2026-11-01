/**
 * Payee review service: preview and apply a human merge / split / rename.
 *
 * Owner state is deterministic: when items move to a payee, the destination payee's last known address goes through
 * resolveOwnerState (code, never a model), then the same timeline recompute the clock advance uses re-derives the legal
 * dates and status. preview and apply share one planner, so the diff the reviewer confirms is exactly what is written.
 * Every query is scoped by company id.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, payees, staleItems, type Company, type LedgerItem, type Payee, type StaleItem } from "@/db/schema";
import * as clock from "@/lib/clock";
import type { IsoDate } from "@/lib/dates";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import { planItemRecompute, recomputeTimelines } from "@/lib/pipeline/recompute";
import { TERMINAL_STATUSES } from "@/lib/pipeline/compute";
import { resolveOwnerState } from "@/lib/rules/priority";
import {
  applyInputSchema,
  PayeeChangeError,
  payeeChangeSchema,
  type ChangePreview,
  type ItemDiff,
  type ItemSnapshot,
  type PayeeChange,
} from "./review-types";

interface Address {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const blank = (s: string | null | undefined) => !s || s.trim() === "";
const hasAddress = (a: Address) => !(blank(a.addressLine) && blank(a.city) && blank(a.state) && blank(a.zip));
const addressOf = (r: Address): Address => ({ addressLine: r.addressLine, city: r.city, state: r.state, zip: r.zip });
const uniq = (xs: string[]) => [...new Set(xs)];

interface Move {
  stale: StaleItem;
  ledger: LedgerItem | undefined;
  ownerState: string | null;
  ownerBasis: StaleItem["ownerStateBasis"];
}

interface Plan {
  preview: ChangePreview;
  /** Payee that ends up owning the moved items (`NEW` = the payee created by a split). */
  target: string | "NEW";
  keeperPatch: Partial<typeof payees.$inferInsert> | null;
  keeperId: string | null;
  newPayee: Omit<typeof payees.$inferInsert, "id"> | null;
  deleteId: string | null;
  ledgerIds: string[];
  moves: Move[];
}

async function getPayee(db: Db, companyId: string, id: string): Promise<Payee> {
  const [row] = await db.select().from(payees).where(and(eq(payees.id, id), eq(payees.companyId, companyId)));
  if (!row) throw new PayeeChangeError("not_found", "That payee no longer exists in this company.");
  return row;
}

/** Load the stale items attached to these ledger lines (or owned by the given payee). */
async function loadMoves(db: Db, companyId: string, ledgerRows: LedgerItem[], ownedBy?: string): Promise<Array<{ stale: StaleItem; ledger: LedgerItem | undefined }>> {
  const ledgerById = new Map(ledgerRows.map((l) => [l.id, l]));
  const conds = [];
  if (ledgerRows.length) conds.push(inArray(staleItems.ledgerItemId, ledgerRows.map((l) => l.id)));
  if (ownedBy) conds.push(eq(staleItems.ownerPayeeId, ownedBy));
  if (!conds.length) return [];
  const rows = await db
    .select()
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), conds.length === 1 ? conds[0]! : or(...conds)));
  const missing = rows.filter((r) => !ledgerById.has(r.ledgerItemId)).map((r) => r.ledgerItemId);
  if (missing.length) {
    const extra = await db.select().from(ledgerItems).where(and(eq(ledgerItems.companyId, companyId), inArray(ledgerItems.id, missing)));
    for (const l of extra) ledgerById.set(l.id, l);
  }
  return rows.map((stale) => ({ stale, ledger: ledgerById.get(stale.ledgerItemId) }));
}

function snapshot(s: StaleItem): ItemSnapshot {
  return { ownerState: s.ownerState, status: s.status, reportDueDate: s.reportDueDate, remitDueDate: s.remitDueDate };
}

function buildDiffs(
  moved: Array<{ stale: StaleItem; ledger: LedgerItem | undefined }>,
  destination: Address,
  company: Company,
  today: IsoDate,
): { moves: Move[]; diffs: ItemDiff[] } {
  const moves: Move[] = [];
  const diffs: ItemDiff[] = [];
  for (const { stale, ledger } of moved) {
    const closed = TERMINAL_STATUSES.has(stale.status);
    let ownerState = stale.ownerState;
    let ownerBasis = stale.ownerStateBasis;
    let after = snapshot(stale);
    if (!closed) {
      // The destination payee's last known address decides; with none on file the line's own address is used.
      const addr = hasAddress(destination) ? destination : ledger ? addressOf(ledger) : destination;
      const owner = resolveOwnerState({
        payee: { address: addr.addressLine, city: addr.city, state: addr.state, zip: addr.zip },
        holder: { stateOfIncorporation: company.incorporationState },
      });
      ownerState = owner.state;
      ownerBasis = owner.basis;
      const plan = planItemRecompute({ ...stale, ownerState }, ledger, company, today);
      after = {
        ownerState,
        status: plan.status,
        reportDueDate: plan.timeline.dates.reportDueDate,
        remitDueDate: plan.timeline.dates.remitDueDate,
      };
    }
    const before = snapshot(stale);
    const ownerStateChanged = before.ownerState !== after.ownerState;
    moves.push({ stale, ledger, ownerState, ownerBasis });
    diffs.push({
      staleItemId: stale.id,
      checkNumber: ledger?.referenceNumber ?? null,
      payeeNameRaw: ledger?.payeeNameRaw ?? "",
      amountCents: stale.amountCents,
      before,
      after,
      closed,
      ownerStateChanged,
      changed: ownerStateChanged || JSON.stringify(before) !== JSON.stringify(after),
    });
  }
  diffs.sort((a, b) => b.amountCents - a.amountCents || a.staleItemId.localeCompare(b.staleItemId));
  return { moves, diffs };
}

function finish(
  change: PayeeChange,
  p: { summary: string; canonical: string; aliases: string[]; noop?: boolean; ledgerLines?: number; diffs?: ItemDiff[] },
): ChangePreview {
  const diffs = p.diffs ?? [];
  const base = {
    kind: change.kind,
    noop: p.noop ?? false,
    summary: p.summary,
    resultingAliases: p.aliases,
    resultingCanonical: p.canonical,
    ledgerLinesMoved: p.ledgerLines ?? 0,
    diffs,
    ownerStateChanges: diffs.filter((d) => d.ownerStateChanged).length,
    amountMovingCents: diffs.reduce((s, d) => s + d.amountCents, 0),
  };
  return { ...base, fingerprint: sha256Hex(canonicalJson({ change, ...base })) };
}

const emptyPlan = (preview: ChangePreview): Plan => ({
  preview,
  target: "NEW",
  keeperPatch: null,
  keeperId: null,
  newPayee: null,
  deleteId: null,
  ledgerIds: [],
  moves: [],
});

async function planMerge(db: Db, companyId: string, change: Extract<PayeeChange, { kind: "merge" }>, company: Company, today: IsoDate): Promise<Plan> {
  const keep = await getPayee(db, companyId, change.keepId);
  const [gone] = await db.select().from(payees).where(and(eq(payees.id, change.mergeId), eq(payees.companyId, companyId)));
  if (!gone) {
    // Exists under another company: treat as not found (never a silent no-op across tenants).
    const [elsewhere] = await db.select({ id: payees.id }).from(payees).where(eq(payees.id, change.mergeId));
    if (elsewhere) throw new PayeeChangeError("not_found", "That payee no longer exists in this company.");
    // The source is already gone (an earlier identical merge). Re-running is a harmless no-op.
    return emptyPlan(finish(change, { summary: `${keep.canonicalName} already includes that payee.`, canonical: keep.canonicalName, aliases: keep.aliases, noop: true }));
  }
  const aliases = uniq([...keep.aliases, gone.canonicalName, ...gone.aliases].map((a) => a.trim())).filter((a) => a && a !== keep.canonicalName);
  const address: Address = hasAddress(keep) ? addressOf(keep) : addressOf(gone);
  const ledgerRows = await db.select().from(ledgerItems).where(and(eq(ledgerItems.companyId, companyId), eq(ledgerItems.payeeId, gone.id)));
  const moved = await loadMoves(db, companyId, ledgerRows, gone.id);
  const { moves, diffs } = buildDiffs(moved, address, company, today);
  return {
    preview: finish(change, {
      summary: `Merge "${gone.canonicalName}" into "${keep.canonicalName}".`,
      canonical: keep.canonicalName,
      aliases,
      ledgerLines: ledgerRows.length,
      diffs,
    }),
    target: keep.id,
    keeperId: keep.id,
    keeperPatch: { aliases, ...address },
    newPayee: null,
    deleteId: gone.id,
    ledgerIds: ledgerRows.map((l) => l.id),
    moves,
  };
}

async function planSplit(db: Db, companyId: string, change: Extract<PayeeChange, { kind: "split" }>, company: Company, today: IsoDate): Promise<Plan> {
  const payee = await getPayee(db, companyId, change.payeeId);
  const alias = change.alias.trim();
  if (alias === payee.canonicalName) throw new PayeeChangeError("invalid", "The canonical name cannot be split out; rename it or merge instead.");
  if (!payee.aliases.includes(alias)) throw new PayeeChangeError("alias_not_found", `"${alias}" is not an alias of ${payee.canonicalName}.`);
  const all = await db.select().from(ledgerItems).where(and(eq(ledgerItems.companyId, companyId), eq(ledgerItems.payeeId, payee.id)));
  const ledgerRows = all.filter((l) => l.payeeNameRaw.trim() === alias);
  if (ledgerRows.length === 0) {
    throw new PayeeChangeError("alias_not_found", `No ledger lines carry the name "${alias}", so there is nothing to split out.`);
  }
  const source = ledgerRows.find((l) => hasAddress(l));
  const address: Address = source ? addressOf(source) : { addressLine: null, city: null, state: null, zip: null };
  const moved = await loadMoves(db, companyId, ledgerRows);
  const { moves, diffs } = buildDiffs(moved, address, company, today);
  const remaining = payee.aliases.filter((a) => a !== alias);
  return {
    preview: finish(change, {
      summary: `Split "${alias}" out of "${payee.canonicalName}" into its own payee.`,
      canonical: payee.canonicalName,
      aliases: remaining,
      ledgerLines: ledgerRows.length,
      diffs,
    }),
    target: "NEW",
    keeperId: payee.id,
    keeperPatch: { aliases: remaining },
    newPayee: { companyId, canonicalName: alias, aliases: [], ...address },
    deleteId: null,
    ledgerIds: ledgerRows.map((l) => l.id),
    moves,
  };
}

async function planRename(db: Db, companyId: string, change: Extract<PayeeChange, { kind: "rename" }>): Promise<Plan> {
  const payee = await getPayee(db, companyId, change.payeeId);
  const next = change.canonicalName.trim();
  if (next === payee.canonicalName) {
    return emptyPlan(finish(change, { summary: `Already named "${next}".`, canonical: next, aliases: payee.aliases, noop: true }));
  }
  const others = await db.select({ id: payees.id, name: payees.canonicalName }).from(payees).where(eq(payees.companyId, companyId));
  if (others.some((o) => o.id !== payee.id && o.name.trim().toLowerCase() === next.toLowerCase())) {
    throw new PayeeChangeError("name_taken", `Another payee is already named "${next}". Merge them instead.`);
  }
  const aliases = uniq([...payee.aliases, payee.canonicalName]).filter((a) => a !== next);
  return {
    ...emptyPlan(finish(change, { summary: `Rename "${payee.canonicalName}" to "${next}".`, canonical: next, aliases })),
    keeperId: payee.id,
    keeperPatch: { canonicalName: next, aliases },
  };
}

async function buildPlan(db: Db, companyId: string, change: PayeeChange): Promise<Plan> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new PayeeChangeError("not_found", "Unknown company.");
  const today = await clock.now(db, companyId);
  switch (change.kind) {
    case "merge":
      return planMerge(db, companyId, change, company, today);
    case "split":
      return planSplit(db, companyId, change, company, today);
    case "rename":
      return planRename(db, companyId, change);
  }
}

function parseChange(raw: unknown): PayeeChange {
  const parsed = payeeChangeSchema.safeParse(raw);
  if (!parsed.success) throw new PayeeChangeError("invalid", parsed.error.issues[0]?.message ?? "Invalid payee change");
  return parsed.data;
}

/** Read-only: what the change would do, with a before/after diff of every affected item. Writes nothing. */
export async function previewPayeeChange(db: Db, companyId: string, rawChange: unknown): Promise<ChangePreview> {
  return (await buildPlan(db, companyId, parseChange(rawChange))).preview;
}

export interface ApplyResult {
  applied: boolean;
  preview: ChangePreview;
  /** The payee that now owns the affected items. */
  payeeId: string | null;
}

/** Commit a reviewed change in one transaction, then re-run the deterministic recompute for the touched items. */
export async function applyPayeeChange(db: Db, companyId: string, rawInput: unknown, now: Date = new Date()): Promise<ApplyResult> {
  const parsed = applyInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new PayeeChangeError("invalid", parsed.error.issues[0]?.message ?? "Invalid payee change");
  const { change, by, fingerprint } = parsed.data;

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const plan = await buildPlan(t, companyId, change);
    if (plan.preview.noop) return { applied: false, preview: plan.preview, payeeId: plan.keeperId };
    if (fingerprint && fingerprint !== plan.preview.fingerprint) {
      throw new PayeeChangeError("stale_preview", "The affected items changed after you opened the preview. Review the new diff and confirm again.");
    }
    const trail = { mergeBasis: "human" as const, mergeConfidence: 100, reviewedBy: by, reviewedAt: now, reviewAction: change.kind };

    let targetId = plan.target;
    if (plan.newPayee) {
      const [created] = await t.insert(payees).values({ ...plan.newPayee, ...trail }).returning({ id: payees.id });
      targetId = created!.id;
    }
    if (plan.keeperId && plan.keeperPatch) {
      await t
        .update(payees)
        .set({ ...plan.keeperPatch, ...trail })
        .where(and(eq(payees.id, plan.keeperId), eq(payees.companyId, companyId)));
    }
    if (plan.ledgerIds.length) {
      await t
        .update(ledgerItems)
        .set({ payeeId: targetId })
        .where(and(eq(ledgerItems.companyId, companyId), inArray(ledgerItems.id, plan.ledgerIds)));
    }
    const recomputeIds = new Set<string>();
    for (const m of plan.moves) {
      const closed = TERMINAL_STATUSES.has(m.stale.status);
      await t
        .update(staleItems)
        .set({ ownerPayeeId: targetId, ...(closed ? {} : { ownerState: m.ownerState, ownerStateBasis: m.ownerBasis }) })
        .where(and(eq(staleItems.id, m.stale.id), eq(staleItems.companyId, companyId)));
      if (!closed) recomputeIds.add(m.stale.id);
    }
    if (plan.deleteId) await t.delete(payees).where(and(eq(payees.id, plan.deleteId), eq(payees.companyId, companyId)));
    if (recomputeIds.size) await recomputeTimelines(t, companyId, { only: recomputeIds });
    return { applied: true, preview: plan.preview, payeeId: targetId === "NEW" ? null : targetId };
  });
}
