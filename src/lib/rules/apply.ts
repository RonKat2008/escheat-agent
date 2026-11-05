import type { Db } from "@/db/client";
import { and, eq, isNull } from "drizzle-orm";
import { ruleApprovals, ruleChanges } from "@/db/schema";
import { approve, withApproval } from "@/lib/approvals";
import { appendAuditEventForSubject } from "@/lib/audit/chain-db";
import { replicaToday } from "@/lib/replica/portal/demo-date";
import { diffRules } from "./diff";
import { approveRuleField, approveRuleFile, loadRules, syncRuleFileToDb, type LoadedRules, type LoadOptions } from "./load";
import { overlayRows, refreshRuleOverlay, type OverlayRow } from "./overlay";
import type { RuleFile } from "../../../rules/schema";
import { listRuleValues } from "./values";

/**
 * Human approval of rule values (security review M3). The click is recorded as an `apply_rule_change` approval whose
 * payload is the EXACT rule version + sha256 the reviewer saw plus the field paths being verified, then consumed to
 * apply the change. If the rules changed since the page rendered (other session, a new checked-in baseline, another
 * approval) the apply fails with `stale` and nothing is written.
 *
 * R4-02: the approval is stored as a rule_approvals row (who, when, value, sources, version) that the loader overlays
 * on the checked-in rules/<STATE>.json. Nothing under rules/ is ever written, so this works on a read-only filesystem.
 * F18 still holds: the overlay changes only the approved envelopes (and `version`); every other field keeps its bytes.
 */

export class RuleApplyError extends Error {
  constructor(
    public readonly code: "stale" | "nothing_to_approve" | "unknown_field",
    message: string,
  ) {
    super(message);
    this.name = "RuleApplyError";
  }
}

export interface ApplyRuleApprovalInput {
  state: string;
  /** One rule field path. */
  path?: string;
  /** An explicit list of field paths the reviewer checked one by one (R4-20). */
  paths?: string[];
  /** Recorded on the approval and the rule value (typed name plus the authenticated session label). */
  by: string;
  /** The version and sha256 shown to the reviewer (from loadRules). */
  expectedVersion: string;
  expectedSha256: string;
}

export interface ApplyRuleApprovalResult {
  version: string;
  approved: number;
  fieldPaths: string[];
  approvalId: string;
}

function countVerified(f: ReturnType<typeof loadRules>["file"]): number {
  return JSON.stringify(f).split('"verified":true').length - 1;
}

const STALE = (state: string) => `The ${state} rules changed since you opened this page. Reload, review the new values, and approve again.`;

/**
 * The version + sha gate shared by every human rule approval (M3): the rules as loaded now (checked-in baseline plus
 * DB approvals) must be EXACTLY what the reviewer saw. Callers re-read the approvals first (refreshForApproval).
 */
export function readRulesForApproval(
  state: string,
  expected: { expectedVersion: string; expectedSha256: string },
  opts: LoadOptions = {},
): { loaded: LoadedRules; rawText: string } {
  const loaded = loadRules(state, opts);
  if (loaded.file.version !== expected.expectedVersion || loaded.sha256 !== expected.expectedSha256) {
    throw new RuleApplyError("stale", STALE(state));
  }
  return { loaded, rawText: loaded.text };
}

/** Re-read the DB approvals into the loader cache before a gate check (unless the caller injected rows). */
export async function refreshForApproval(db: Db, opts: LoadOptions): Promise<void> {
  if (!opts.overlay) await refreshRuleOverlay(db);
}

/**
 * The instant an approval's version suffix is stamped from (R6-12, R7-04): the approval is happening now, so it is
 * stamped with the demo date the clock shows now, keeping the real time of day. This holds when the demo date is
 * before AND after the real date. The stored approvedAt stays the real timestamp.
 */
export function versionStampAt(at: string, demoToday: string): string {
  return `${demoToday}${at.slice(10)}`;
}

/** `<base>+appr.<YYYYMMDDTHHMMSS>`: the version an approval writes. */
export function approvedVersion(baseVersion: string, at: string): string {
  const stamp = at.replace(/[-:]/g, "").replace(/\..*$/, "");
  return `${baseVersion.replace(/\+appr\..*$/, "")}+appr.${stamp}`;
}

/** A version string not yet used for this state (two approvals in the same second get a numeric suffix). */
export function uniqueApprovedVersion(baseVersion: string, at: string, rows: readonly OverlayRow[], state: string): string {
  const v = approvedVersion(baseVersion, at);
  const used = new Set(rows.filter((r) => r.state === state).map((r) => r.version));
  if (!used.has(v)) return v;
  let n = 2;
  while (used.has(`${v}.${n}`)) n++;
  return `${v}.${n}`;
}

export interface CommitApprovalInput {
  state: string;
  loaded: LoadedRules;
  /** The approval to persist (version already chosen with uniqueApprovedVersion). */
  row: OverlayRow;
  /** Exactly the payload the approval was recorded with. */
  payload: unknown;
  by: string;
  approvalId: string;
  sourceUrls?: string[];
}

/**
 * Consume the recorded apply_rule_change approval (it must match `payload` exactly) and, inside it and one transaction:
 * insert the rule_approvals row, sync state_rules to the new overlaid version and log a rule_changes row. Then refresh
 * the loader cache so every surface sees the new version.
 */
export async function commitRuleApproval(db: Db, input: CommitApprovalInput, opts: LoadOptions & { now?: Date } = {}): Promise<RuleFile> {
  const rows = [...(opts.overlay ?? overlayRows()), input.row];
  const next = loadRules(input.state, { ...opts, overlay: rows });
  if (next.file.version !== input.row.version) throw new RuleApplyError("stale", STALE(input.state));
  await withApproval(db, { action: "apply_rule_change", subjectId: input.state, payload: input.payload }, async () => {
    await db.transaction(async (tx) => {
      const r = input.row;
      await tx.insert(ruleApprovals).values({
        state: r.state,
        kind: r.kind,
        baseVersion: r.baseVersion,
        baseSha256: r.baseSha256,
        version: r.version,
        fieldPaths: r.fieldPaths,
        value: r.value,
        ownerText: r.ownerText,
        sources: r.sources,
        note: r.note,
        approvedBy: r.approvedBy,
        approvedAt: new Date(r.approvedAt),
        approvalId: input.approvalId,
      });
      await syncRuleFileToDb(tx as unknown as Db, next);
      await tx.insert(ruleChanges).values({
        state: input.state,
        fromVersion: input.loaded.file.version,
        toVersion: next.file.version,
        diff: {
          changes: diffRules(input.loaded.file, next.file),
          approvedBy: input.by,
          approvalId: input.approvalId,
          fieldPaths: r.fieldPaths,
          ...(r.ownerText ? { ownerText: r.ownerText } : {}),
        },
        sourceUrls: input.sourceUrls ?? [],
        status: "applied",
        reviewedBy: input.by,
        reviewedAt: new Date(),
      });
      // Audit chain: rule.approved for every company holding items or reports in this state, same transaction.
      await appendAuditEventForSubject(tx as unknown as Db, input.state, {
        kind: "rule.approved",
        subjectType: "rule_approval",
        subjectId: `${input.state}@${next.file.version}`,
        occurredAt: new Date(r.approvedAt),
        payload: { state: input.state, fromVersion: input.loaded.file.version, toVersion: next.file.version, kind: r.kind, fieldPaths: r.fieldPaths, approvedBy: r.approvedBy, approvalId: input.approvalId },
      });
    });
  }, { now: opts.now });
  await refreshForApproval(db, opts);
  return next.file;
}

export async function applyRuleApproval(
  db: Db,
  input: ApplyRuleApprovalInput,
  opts: LoadOptions & { now?: Date } = {},
): Promise<ApplyRuleApprovalResult> {
  await refreshForApproval(db, opts);
  const { loaded } = readRulesForApproval(input.state, input, opts);
  const at = (opts.now ?? new Date()).toISOString();
  const requested = input.paths ?? (input.path ? [input.path] : null);
  let next = loaded.file;
  if (requested) {
    const known = new Set(listRuleValues(loaded.file).map((v) => v.path));
    const bad = requested.find((p) => !known.has(p));
    if (bad) throw new RuleApplyError("unknown_field", `Unknown rule field: ${bad}`);
    for (const p of requested) next = approveRuleField(next, p, input.by, at);
  } else next = approveRuleFile(loaded.file, input.by, at);
  const approved = countVerified(next) - countVerified(loaded.file);
  if (approved === 0) throw new RuleApplyError("nothing_to_approve", "Nothing to approve: those values are already verified, or have no value.");

  const before = new Set(listRuleValues(loaded.file).filter((v) => v.rv.verified).map((v) => v.path));
  const fieldPaths = listRuleValues(next)
    .filter((v) => v.rv.verified && !before.has(v.path))
    .map((v) => v.path)
    .sort();
  const payload = { state: input.state, baseVersion: loaded.file.version, baseSha256: loaded.sha256, fieldPaths };

  const approval = await approve(db, { action: "apply_rule_change", subjectId: input.state, payload, approvedBy: input.by }, opts.now);
  const base = loaded.file.version.replace(/\+appr\..*$/, "");
  const row: OverlayRow = {
    state: input.state,
    kind: "verify",
    baseVersion: base,
    baseSha256: loaded.baseSha256,
    version: uniqueApprovedVersion(base, (opts.now ? at : versionStampAt(at, await replicaToday(db))), opts.overlay ?? overlayRows(), input.state),
    fieldPaths,
    value: null,
    ownerText: null,
    sources: [],
    note: null,
    approvedBy: input.by,
    approvedAt: at,
  };
  const versioned = await commitRuleApproval(db, { state: input.state, loaded, row, payload, by: input.by, approvalId: approval.id }, opts);
  return { version: versioned.version, approved: fieldPaths.length, fieldPaths, approvalId: approval.id };
}

export interface WithdrawRuleApprovalInput {
  state: string;
  /** The approval version to withdraw. It must be the current (latest) version of the state's rules. */
  version: string;
  /** Who withdraws it (typed name plus the authenticated session label). */
  by: string;
}

/**
 * Withdraw the latest human rule approval (a mistaken click, or a rehearsal). The row is kept with withdrawn_at/by for
 * the audit trail and the loader stops overlaying it, so the rules fall back to the previous version. Recorded and
 * consumed as an apply_rule_change approval like every other rule change; logged in rule_changes.
 */
export async function withdrawRuleApproval(
  db: Db,
  input: WithdrawRuleApprovalInput,
  opts: LoadOptions & { now?: Date } = {},
): Promise<{ withdrawn: string; current: string }> {
  const by = input.by.trim();
  if (by.length < 2) throw new RuleApplyError("nothing_to_approve", "Enter your name to withdraw an approval.");
  await refreshForApproval(db, opts);
  const loaded = loadRules(input.state, opts);
  const rows = opts.overlay ?? overlayRows();
  const target = rows.find((r) => r.state === input.state && r.version === input.version && r.baseSha256 === loaded.baseSha256);
  if (!target || loaded.file.version !== input.version) {
    throw new RuleApplyError("stale", `Only the latest ${input.state} approval can be withdrawn, and ${input.version} is not it. Reload and try again.`);
  }
  const previous = loadRules(input.state, { ...opts, overlay: rows.filter((r) => r !== target) });
  const payload = { state: input.state, withdraw: input.version, baseSha256: loaded.sha256 };
  await approve(db, { action: "apply_rule_change", subjectId: input.state, payload, approvedBy: by }, opts.now);
  await withApproval(db, { action: "apply_rule_change", subjectId: input.state, payload }, async (approval) => {
    await db.transaction(async (tx) => {
      const done = await tx
        .update(ruleApprovals)
        .set({ withdrawnAt: opts.now ?? new Date(), withdrawnBy: by })
        .where(and(eq(ruleApprovals.state, input.state), eq(ruleApprovals.version, input.version), isNull(ruleApprovals.withdrawnAt)))
        .returning({ id: ruleApprovals.id });
      if (done.length !== 1) throw new RuleApplyError("stale", STALE(input.state));
      await syncRuleFileToDb(tx as unknown as Db, previous);
      await tx.insert(ruleChanges).values({
        state: input.state,
        fromVersion: input.version,
        toVersion: previous.file.version,
        diff: { changes: diffRules(loaded.file, previous.file), withdrawn: input.version, withdrawnBy: by, approvalId: approval.id },
        sourceUrls: [],
        status: "applied",
        reviewedBy: by,
        reviewedAt: new Date(),
      });
      await appendAuditEventForSubject(tx as unknown as Db, input.state, {
        kind: "rule.withdrawn",
        subjectType: "rule_approval",
        subjectId: `${input.state}@${input.version}`,
        occurredAt: opts.now ?? new Date(),
        payload: { state: input.state, withdrawn: input.version, nowCurrent: previous.file.version, withdrawnBy: by, approvalId: approval.id },
      });
    });
  });
  await refreshForApproval(db, opts);
  return { withdrawn: input.version, current: previous.file.version };
}
