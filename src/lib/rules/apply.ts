import type { Db } from "@/db/client";
import { ruleChanges } from "@/db/schema";
import { approve, withApproval } from "@/lib/approvals";
import { diffRules } from "./diff";
import { approveRuleField, approveRuleFile, loadRules, saveRuleVersion, syncRuleFileToDb, type LoadOptions } from "./load";
import { listRuleValues } from "./values";

/**
 * Human approval of rule values (security review M3). The click is recorded as an `apply_rule_change` approval whose
 * payload is the EXACT rule file version + sha256 the reviewer saw plus the field paths being verified, then consumed
 * to apply the change. If the file on disk changed since the page rendered (other session, git pull, research apply)
 * the apply fails with `stale` and nothing is written.
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

export async function applyRuleApproval(
  db: Db,
  input: ApplyRuleApprovalInput,
  opts: LoadOptions & { now?: Date } = {},
): Promise<ApplyRuleApprovalResult> {
  const loaded = loadRules(input.state, opts);
  if (loaded.file.version !== input.expectedVersion || loaded.sha256 !== input.expectedSha256) {
    throw new RuleApplyError("stale", `The ${input.state} rules changed since you opened this page. Reload, review the new values, and approve again.`);
  }
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
  const stamp = at.replace(/[-:]/g, "").replace(/\..*$/, "");
  const base = loaded.file.version.replace(/\+appr\..*$/, "");
  const versioned = { ...next, version: `${base}+appr.${stamp}` };

  await withApproval(db, { action: "apply_rule_change", subjectId: input.state, payload }, async () => {
    saveRuleVersion(versioned, opts);
    await syncRuleFileToDb(db, loadRules(input.state, opts));
    await db.insert(ruleChanges).values({
      state: input.state,
      fromVersion: loaded.file.version,
      toVersion: versioned.version,
      diff: { changes: diffRules(loaded.file, versioned), approvedBy: input.by, approvalId: approval.id, fieldPaths },
      sourceUrls: [],
      status: "applied",
      reviewedBy: input.by,
      reviewedAt: new Date(),
    });
  });
  return { version: versioned.version, approved, fieldPaths, approvalId: approval.id };
}
