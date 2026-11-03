import type { Db } from "@/db/client";
import { ruleChanges } from "@/db/schema";
import { approve, withApproval } from "@/lib/approvals";
import { diffRules } from "./diff";
import { readFileSync } from "node:fs";
import {
  approveRawFields,
  approveRuleField,
  approveRuleFile,
  loadRules,
  parseRuleText,
  ruleFileText,
  saveRuleText,
  sha256Hex,
  syncRuleFileToDb,
  type LoadedRules,
  type LoadOptions,
} from "./load";
import type { RuleFile } from "../../../rules/schema";
import { listRuleValues } from "./values";

/**
 * Human approval of rule values (security review M3). The click is recorded as an `apply_rule_change` approval whose
 * payload is the EXACT rule file version + sha256 the reviewer saw plus the field paths being verified, then consumed
 * to apply the change. If the file on disk changed since the page rendered (other session, git pull, research apply)
 * the apply fails with `stale` and nothing is written.
 *
 * F18: the new version is written from the RAW file text with only the approved envelopes (and `version`) changed,
 * so every other field (sources, wrapped includesRemittance, notes, portal...) keeps its exact bytes.
 */

export class RuleApplyError extends Error {
  constructor(
    public readonly code: "stale" | "nothing_to_approve",
    message: string,
  ) {
    super(message);
    this.name = "RuleApplyError";
  }
}

export interface ApplyRuleApprovalInput {
  state: string;
  /** One rule field path, or omitted to verify every field that has a value. */
  path?: string;
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
 * The version + sha gate shared by every human rule approval (M3): the file on disk must be EXACTLY what the reviewer
 * saw, both as parsed (version) and as raw bytes (sha256). Returns the loaded file and its raw text.
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
  const rawText = readFileSync(loaded.source, "utf8");
  if (sha256Hex(rawText) !== expected.expectedSha256) throw new RuleApplyError("stale", STALE(state));
  return { loaded, rawText };
}

/** `<base>+appr.<YYYYMMDDTHHMMSS>`: the version an approval writes. */
export function approvedVersion(baseVersion: string, at: string): string {
  const stamp = at.replace(/[-:]/g, "").replace(/\..*$/, "");
  return `${baseVersion.replace(/\+appr\..*$/, "")}+appr.${stamp}`;
}

export interface CommitApprovedInput {
  state: string;
  loaded: LoadedRules;
  /** The full new rule file text (already carrying the new `version`). */
  text: string;
  /** Exactly the payload the approval was recorded with. */
  payload: unknown;
  by: string;
  approvalId: string;
  fieldPaths: string[];
  sourceUrls?: string[];
}

/**
 * Consume the recorded apply_rule_change approval (it must match `payload` exactly) and, inside it, write the new
 * version (rules/<STATE>.json + rules/history/<STATE>/<version>.json), sync state_rules and log a rule_changes row.
 */
export async function commitApprovedRuleText(db: Db, input: CommitApprovedInput, opts: LoadOptions = {}): Promise<RuleFile> {
  const versioned = parseRuleText(input.text).file;
  await withApproval(db, { action: "apply_rule_change", subjectId: input.state, payload: input.payload }, async () => {
    saveRuleText(input.state, versioned.version, input.text, opts);
    await syncRuleFileToDb(db, loadRules(input.state, opts));
    await db.insert(ruleChanges).values({
      state: input.state,
      fromVersion: input.loaded.file.version,
      toVersion: versioned.version,
      diff: { changes: diffRules(input.loaded.file, versioned), approvedBy: input.by, approvalId: input.approvalId, fieldPaths: input.fieldPaths },
      sourceUrls: input.sourceUrls ?? [],
      status: "applied",
      reviewedBy: input.by,
      reviewedAt: new Date(),
    });
  });
  return versioned;
}

export async function applyRuleApproval(
  db: Db,
  input: ApplyRuleApprovalInput,
  opts: LoadOptions & { now?: Date } = {},
): Promise<ApplyRuleApprovalResult> {
  const { loaded, rawText } = readRulesForApproval(input.state, input, opts);
  const at = (opts.now ?? new Date()).toISOString();
  const next = input.path ? approveRuleField(loaded.file, input.path, input.by, at) : approveRuleFile(loaded.file, input.by, at);
  const approved = countVerified(next) - countVerified(loaded.file);
  if (approved === 0) throw new RuleApplyError("nothing_to_approve", "Nothing to approve: those values are already verified, or have no value.");

  const before = new Set(listRuleValues(loaded.file).filter((v) => v.rv.verified).map((v) => v.path));
  const fieldPaths = listRuleValues(next)
    .filter((v) => v.rv.verified && !before.has(v.path))
    .map((v) => v.path)
    .sort();
  const payload = { state: input.state, baseVersion: loaded.file.version, baseSha256: loaded.sha256, fieldPaths };

  const approval = await approve(db, { action: "apply_rule_change", subjectId: input.state, payload, approvedBy: input.by }, opts.now);
  const version = approvedVersion(loaded.file.version, at);
  const rawNext = { ...approveRawFields(JSON.parse(rawText), fieldPaths, input.by, at), version };
  // Keep key order: `version` stays where it was in the original file.
  const text = ruleFileText(rawNext);
  const versioned = await commitApprovedRuleText(db, { state: input.state, loaded, text, payload, by: input.by, approvalId: approval.id, fieldPaths }, opts);
  return { version: versioned.version, approved, fieldPaths, approvalId: approval.id };
}
