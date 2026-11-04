import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems } from "@/db/schema";
import { approve } from "@/lib/approvals";
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import { planBulkDraftFromDb, type DraftSkipCode, type PlanEntry } from "@/lib/outreach/bulk";
import type { RuleSource, RuleValue } from "../../../rules/schema";
import { commitRuleApproval, readRulesForApproval, refreshForApproval, uniqueApprovedVersion } from "./apply";
import { applyApprovalRow, loadRules, parseRuleText, ruleFileText, sha256Hex, tryLoadRules, type LoadedRules, type LoadOptions } from "./load";
import { overlayRows, type OverlayRow } from "./overlay";
import { needsOwnerText, ownerTextProblem } from "./owner-text";
import { proposedValue, type ProposedValue } from "./proposed";
import { describeRuleStatus, type RuleStatusCopy } from "./unknown-copy";
import { listRuleValues } from "./values";

/**
 * R3-05 "adopt proposed value": a human approves setting a still-UNKNOWN rule value to the exact text an official
 * cited source declares (see ./proposed.ts). The LLM never decides the value: the text is extracted deterministically,
 * the reviewer must send back the exact text they saw, and the write goes through the same version+sha gate,
 * apply_rule_change approval, rule_approvals row and rule_changes log as every other rule approval (./apply.ts).
 *
 * R4-01: notice language is printed in owner letters, so adopting it also needs an owner-facing sentence the human
 * wrote ("Statute says" / "Owner letter will say"). The verbatim statute text stays the rule value (the requirement);
 * letters print only the approved owner sentence (./owner-text.ts). The sentence is never generated.
 *
 * API shapes (also served by /api/rules/[state]/adopt):
 *   describeAdoption(db, { state, path, companyId }) -> AdoptionPreview   (read-only)
 *   adoptProposedValue(db, { state, path, by, expectedVersion, expectedSha256, proposedText, ownerText }) -> AdoptResult
 */

export type RuleAdoptErrorCode =
  | "approver_required"
  | "unknown_field"
  | "already_set"
  | "no_proposal"
  | "text_mismatch"
  | "invalid_value"
  | "owner_text_invalid";

export class RuleAdoptError extends Error {
  constructor(
    public readonly code: RuleAdoptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuleAdoptError";
  }
}

const MIN_APPROVER_CHARS = 2;

function envelopeAt(loaded: LoadedRules, path: string): RuleValue<unknown> {
  const hit = listRuleValues(loaded.file).find((v) => v.path === path);
  if (!hit) throw new RuleAdoptError("unknown_field", `There is no rule field "${path}" for ${loaded.file.state}.`);
  return hit.rv;
}

/* ------------------------------------------------------------------ adopt */

export interface AdoptProposedValueInput {
  state: string;
  path: string;
  /** The approver (typed name plus session label). Required. */
  by: string;
  /** Version + sha256 of the rule file the reviewer saw. */
  expectedVersion: string;
  expectedSha256: string;
  /** The exact proposed text the reviewer saw; must equal the current verbatim proposal character for character. */
  proposedText: string;
  /** R4-01: the owner-facing sentence the reviewer wrote. Required for notice language (see needsOwnerText). */
  ownerText?: string | null;
}

export interface AdoptResult {
  version: string;
  path: string;
  value: string;
  verifiedBy: string;
  verifiedAt: string;
  sources: RuleSource[];
  approvalId: string;
  /** The approved owner-facing sentence, when the field needs one. */
  ownerText: string | null;
}

export async function adoptProposedValue(db: Db, input: AdoptProposedValueInput, opts: LoadOptions & { now?: Date } = {}): Promise<AdoptResult> {
  const by = input.by.trim();
  if (by.length < MIN_APPROVER_CHARS) throw new RuleAdoptError("approver_required", "Enter your name to approve this value.");
  const ownerText = needsOwnerText(input.path) ? (input.ownerText ?? "").trim() : null;
  if (ownerText !== null) {
    const problem = ownerTextProblem(ownerText);
    if (problem) throw new RuleAdoptError("owner_text_invalid", problem);
  }
  await refreshForApproval(db, opts);
  const { loaded, rawText } = readRulesForApproval(input.state, input, opts);
  const envelope = envelopeAt(loaded, input.path);
  if (envelope.value !== null) throw new RuleAdoptError("already_set", "This rule already has a value. Use Approve to confirm it instead.");
  const proposal = proposedValue(envelope);
  if (proposal.confidence !== "verbatim_quote" || proposal.proposed === null || proposal.quote === null) {
    throw new RuleAdoptError("no_proposal", "No official source quotes text for this rule, so there is nothing to adopt.");
  }
  if (ownerText !== null) {
    // R5-02: the sentence must carry the elements the statute text calls for (deterministic, derived from the rule).
    const content = ownerTextProblem(ownerText, proposal.proposed);
    if (content) throw new RuleAdoptError("owner_text_invalid", content);
  }
  // The adopted text must be exactly the quoted source text the reviewer saw.
  if (input.proposedText !== proposal.proposed || !proposal.quote.includes(proposal.proposed)) {
    throw new RuleAdoptError("text_mismatch", "The proposed text changed since you reviewed it. Reload and review it again.");
  }

  const at = (opts.now ?? new Date()).toISOString();
  const source = proposal.sources[0]!;
  const note = `Adopted verbatim from ${source.title || source.url} (${source.url}) by ${by}.${ownerText ? " Owner letters print the owner-facing sentence approved with it." : ""} The research note stays in the checked-in rule file.`;
  const baseVersion = loaded.file.version.replace(/\+appr\..*$/, "");
  const row: OverlayRow = {
    state: input.state,
    kind: "adopt",
    baseVersion,
    baseSha256: loaded.baseSha256,
    version: uniqueApprovedVersion(baseVersion, at, opts.overlay ?? overlayRows(), input.state),
    fieldPaths: [input.path],
    value: proposal.proposed,
    ownerText,
    sources: proposal.sources,
    note,
    approvedBy: by,
    approvedAt: at,
  };
  // Validate BEFORE anything is recorded: the field must accept text, or the parser would turn it back into UNKNOWN.
  const check = listRuleValues(parseRuleText(ruleFileText(applyApprovalRow(JSON.parse(rawText), row))).file).find((v) => v.path === input.path)?.rv;
  if (!check || check.value !== proposal.proposed) {
    throw new RuleAdoptError("invalid_value", "This rule field does not take text, so a quote cannot be adopted for it.");
  }

  const payload = {
    state: input.state,
    baseVersion: loaded.file.version,
    baseSha256: loaded.sha256,
    fieldPaths: [input.path],
    adopt: {
      path: input.path,
      valueSha256: sha256Hex(proposal.proposed),
      sourceUrls: proposal.sources.map((s) => s.url),
      ...(ownerText ? { ownerTextSha256: sha256Hex(ownerText) } : {}),
    },
  };
  const approval = await approve(db, { action: "apply_rule_change", subjectId: input.state, payload, approvedBy: by }, opts.now);
  const versioned = await commitRuleApproval(
    db,
    { state: input.state, loaded, row, payload, by, approvalId: approval.id, sourceUrls: payload.adopt.sourceUrls },
    opts,
  );
  return {
    version: versioned.version,
    path: input.path,
    value: proposal.proposed,
    verifiedBy: by,
    verifiedAt: at,
    sources: proposal.sources,
    approvalId: approval.id,
    ownerText,
  };
}

/* ------------------------------------------------------------------ describe (read-only) */

/** The rule path the bulk pre-flight blocks letters on. Only this field gates drafting today. */
const LETTER_GATING_PATH = "dueDiligence.requiredLanguage";

export interface AdoptionImpact {
  /** Open items in the state that the pre-flight blocks on this rule today. */
  blockedByRule: { count: number; amountCents: number };
  /** Of those, items whose letter becomes draftable once the value is adopted (blocked ONLY by this rule). */
  becomeDraftable: { count: number; amountCents: number; staleItemIds: string[] };
  /** Of those, items still blocked after adoption for another reason, counted by skip code. */
  stillBlocked: { count: number; amountCents: number; byReason: Partial<Record<DraftSkipCode, number>> };
}

export interface AdoptionPreview {
  state: string;
  path: string;
  /** Send these back with the adopt call. */
  expectedVersion: string;
  expectedSha256: string;
  proposal: ProposedValue;
  before: { value: unknown; verified: boolean; status: RuleStatusCopy };
  /** null when there is no verbatim proposal to adopt. */
  after: { value: string; verified: true; sources: RuleSource[] } | null;
  /** Every source cited on the field (the adopted value keeps all of them). */
  citations: RuleSource[];
  /** null when the field does not gate drafting, or there is nothing to adopt. */
  impact: AdoptionImpact | null;
  /**
   * R4-01: the owner-facing sentence. `required` for notice language. `prefill` is empty: there is no deterministic
   * statute-to-owner transform, and the wording is never generated, so the reviewer writes it.
   */
  ownerText: { required: boolean; prefill: string };
}

const chunks = <T>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function planAll(db: Db, companyId: string, ids: string[], loader: typeof tryLoadRules): Promise<Map<string, PlanEntry>> {
  const out = new Map<string, PlanEntry>();
  for (const batch of chunks(ids, BULK_MAX)) {
    const { plan } = await planBulkDraftFromDb(db, { companyId, channel: "letter", staleItemIds: batch }, { loadRules: loader });
    for (const e of plan) out.set(e.staleItemId, e);
  }
  return out;
}

const blockedByThisRule = (e: PlanEntry | undefined, path: string): boolean =>
  e?.decision === "skip" && e.code === "rule_unknown" && e.detail.rule === path;

async function computeImpact(db: Db, loaded: LoadedRules, path: string, proposed: string, companyId: string, opts: LoadOptions): Promise<AdoptionImpact> {
  const state = loaded.file.state;
  const rows = await db
    .select({ id: staleItems.id, amountCents: staleItems.amountCents })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state)));
  const amount = new Map(rows.map((r) => [r.id, r.amountCents]));
  const ids = rows.map((r) => r.id);

  const current: typeof tryLoadRules = (st) => tryLoadRules(st, opts);
  const adopted: typeof tryLoadRules = (st) => {
    if (st.toUpperCase() !== state) return tryLoadRules(st, opts);
    const file = structuredClone(loaded.file);
    const rv = listRuleValues(file).find((v) => v.path === path)!.rv;
    rv.value = proposed;
    rv.verified = true;
    if (needsOwnerText(path)) rv.owner_text = "(the owner-facing sentence the reviewer approves)";
    return { ...loaded, file };
  };
  const before = await planAll(db, companyId, ids, current);
  const after = await planAll(db, companyId, ids, adopted);

  const sum = (xs: string[]) => xs.reduce((a, id) => a + (amount.get(id) ?? 0), 0);
  const blocked = ids.filter((id) => blockedByThisRule(before.get(id), path));
  const draftable = blocked.filter((id) => after.get(id)?.decision === "will_draft");
  const still = blocked.filter((id) => after.get(id)?.decision !== "will_draft");
  const byReason: Partial<Record<DraftSkipCode, number>> = {};
  for (const id of still) {
    const e = after.get(id);
    if (e?.decision === "skip") byReason[e.code] = (byReason[e.code] ?? 0) + 1;
  }
  return {
    blockedByRule: { count: blocked.length, amountCents: sum(blocked) },
    becomeDraftable: { count: draftable.length, amountCents: sum(draftable), staleItemIds: draftable },
    stillBlocked: { count: still.length, amountCents: sum(still), byReason },
  };
}

/**
 * Before/after, citations and outreach impact of adopting the proposed value for one rule field. Read-only: reuses
 * the bulk-draft pre-flight (planBulkDraftFromDb) twice, once with the rule file as it is and once with the proposed
 * value in place, and reports items that move from "blocked by this rule" to "will draft".
 */
export async function describeAdoption(
  db: Db,
  args: { state: string; path: string; companyId: string | null },
  opts: LoadOptions = {},
): Promise<AdoptionPreview> {
  const loaded = loadRules(args.state, opts);
  const envelope = envelopeAt(loaded, args.path);
  const proposal = proposedValue(envelope);
  const after = proposal.proposed !== null ? { value: proposal.proposed, verified: true as const, sources: proposal.sources } : null;
  const impact =
    after && args.path === LETTER_GATING_PATH && args.companyId
      ? await computeImpact(db, loaded, args.path, after.value, args.companyId, opts)
      : null;
  return {
    state: loaded.file.state,
    path: args.path,
    expectedVersion: loaded.file.version,
    expectedSha256: loaded.sha256,
    proposal,
    before: { value: envelope.value, verified: envelope.verified, status: describeRuleStatus(loaded.file.state, args.path, envelope) },
    after,
    citations: envelope.sources,
    impact,
    ownerText: { required: needsOwnerText(args.path), prefill: "" },
  };
}

/** Letters in `state` the bulk pre-flight would draft right now (live count shown after an approval). */
export async function draftableLetters(db: Db, args: { state: string; companyId: string }, opts: LoadOptions = {}): Promise<{ count: number; amountCents: number }> {
  const rows = await db
    .select({ id: staleItems.id, amountCents: staleItems.amountCents })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, args.companyId), eq(staleItems.ownerState, args.state.toUpperCase())));
  const plan = await planAll(db, args.companyId, rows.map((r) => r.id), (st) => tryLoadRules(st, opts));
  const ok = rows.filter((r) => plan.get(r.id)?.decision === "will_draft");
  return { count: ok.length, amountCents: ok.reduce((a, r) => a + r.amountCents, 0) };
}
