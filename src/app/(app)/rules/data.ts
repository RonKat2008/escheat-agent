import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listRuleStates, loadRules, pinRules, RULES_DIR, tryLoadRules } from "@/lib/rules/load";
import { diffRules, type RuleFieldChange } from "@/lib/rules/diff";
import { listRuleValues } from "@/lib/rules/values";
import { parseRuleFile, type RuleFile } from "../../../../rules/schema";

export interface VersionInfo {
  version: string;
  current: boolean;
  researchedAt: string;
  verifiedBy: string[];
  verifiedCount: number;
  fieldCount: number;
}

export interface StateSummary {
  state: string;
  version: string;
  unverified: number;
  total: number;
}

function summarize(file: RuleFile) {
  const vals = listRuleValues(file);
  const by = new Set(vals.map((v) => v.rv.verified_by).filter((x): x is string => Boolean(x)));
  return { total: vals.length, verified: vals.filter((v) => v.rv.verified).length, by: [...by] };
}

export function listStates(): StateSummary[] {
  return listRuleStates().flatMap((state) => {
    const l = tryLoadRules(state);
    if (!l) return [];
    const s = summarize(l.file);
    return [{ state, version: l.file.version, unverified: s.total - s.verified, total: s.total }];
  });
}

/** The current rule file plus every readable history file for a state, current first, then newest version first. */
function readVersionFiles(state: string): { file: RuleFile; current: boolean }[] {
  const cur = tryLoadRules(state);
  const out: { file: RuleFile; current: boolean }[] = [];
  const dir = path.join(RULES_DIR, "history", state);
  const seen = new Set<string>();
  const add = (file: RuleFile, current: boolean) => {
    if (seen.has(file.version)) return;
    seen.add(file.version);
    out.push({ file, current });
  };
  if (cur) add(cur.file, true);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const r = parseRuleFile(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
        if (r.ok) add(r.file, false);
      } catch {
        /* skip unreadable history file */
      }
    }
  }
  return out.sort((a, b) => (a.current === b.current ? b.file.version.localeCompare(a.file.version) : a.current ? -1 : 1));
}

export function listVersions(state: string): VersionInfo[] {
  return readVersionFiles(state).map(({ file, current }) => {
    const s = summarize(file);
    return { version: file.version, current, researchedAt: file.researched_at, verifiedBy: s.by, verifiedCount: s.verified, fieldCount: s.total };
  });
}

export interface FieldVersion {
  version: string;
  current: boolean;
  value: unknown;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * Per-field history across every saved version, newest first (current file first).
 */
export function fieldHistory(state: string): Record<string, FieldVersion[]> {
  const files = readVersionFiles(state);
  const all: Record<string, FieldVersion[]> = {};
  for (const { file, current } of files) {
    for (const { path: p, rv } of listRuleValues(file)) {
      (all[p] ??= []).push({
        version: file.version,
        current,
        value: rv.value,
        verified: rv.verified,
        verifiedBy: rv.verified_by ?? null,
        verifiedAt: rv.verified_at ?? null,
      });
    }
  }
  return all;
}

export function loadCurrent(state: string): RuleFile | null {
  try {
    return loadRules(state).file;
  } catch {
    return null;
  }
}

export function diffVersions(state: string, from: string, to: string): RuleFieldChange[] | null {
  try {
    return diffRules(pinRules(state, from).file, pinRules(state, to).file);
  } catch {
    return null;
  }
}
