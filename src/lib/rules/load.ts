/**
 * Rule-file loading, pinning, DB sync and approval.
 *
 * Layout:  rules/<STATE>.json            current version
 *          rules/history/<STATE>/<version>.json   every version ever current or approved (immutable)
 *
 * Approval is non-destructive: approveRuleField/approveRuleFile return a NEW RuleFile object and
 * saveRuleVersion writes it as a NEW version under rules/history/<STATE>/ (optionally making it current).
 * Existing history files are never overwritten with different content.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "@/db/client";
import { stateRules, type PropertyType } from "@/db/schema";
import { PROPERTY_TYPES, parseRuleFile, type ParseWarning, type RuleFile } from "../../../rules/schema";
import { allVerified, listRuleValues, listRuleValuesFor } from "./values";

export const RULES_DIR = path.join(process.cwd(), "rules");

export class RuleLoadError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = "RuleLoadError";
  }
}

export interface LoadedRules {
  file: RuleFile;
  sha256: string;
  warnings: ParseWarning[];
  /** Absolute path the file was read from. */
  source: string;
}

export interface LoadOptions {
  /** Override the rules directory (tests). */
  dir?: string;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseText(text: string, source: string): LoadedRules {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new RuleLoadError(`${source}: not valid JSON`, [(e as Error).message]);
  }
  const r = parseRuleFile(raw);
  if (!r.ok) throw new RuleLoadError(`${source}: invalid rule file`, r.errors);
  return { file: r.file, sha256: sha256Hex(text), warnings: r.warnings, source };
}

const stateCode = (s: string) => {
  if (!/^[A-Za-z]{2}$/.test(s)) throw new RuleLoadError(`Invalid state code: ${s}`);
  return s.toUpperCase();
};

/** Load and validate rules/<STATE>.json. Throws RuleLoadError (missing, bad JSON, malformed). */
export function loadRules(state: string, opts: LoadOptions = {}): LoadedRules {
  const st = stateCode(state);
  const file = path.join(opts.dir ?? RULES_DIR, `${st}.json`);
  if (!existsSync(file)) throw new RuleLoadError(`No rule file for ${st} at ${file}`);
  const loaded = parseText(readFileSync(file, "utf8"), file);
  if (loaded.file.state !== st) throw new RuleLoadError(`${file}: state field ${loaded.file.state} does not match filename`);
  return loaded;
}

/** Like loadRules but returns null when there is no file (a missing rule means UNKNOWN, never a guess). */
export function tryLoadRules(state: string, opts: LoadOptions = {}): LoadedRules | null {
  try {
    return loadRules(state, opts);
  } catch (e) {
    if (e instanceof RuleLoadError && e.message.startsWith("No rule file")) return null;
    throw e;
  }
}

/** Pin to an exact version: the current file if it matches, else rules/history/<STATE>/<version>.json. */
export function pinRules(state: string, version: string, opts: LoadOptions = {}): LoadedRules {
  const st = stateCode(state);
  const dir = opts.dir ?? RULES_DIR;
  const current = tryLoadRules(st, opts);
  if (current && current.file.version === version) return current;
  const hist = path.join(dir, "history", st, `${safeName(version)}.json`);
  if (!existsSync(hist)) throw new RuleLoadError(`Rule version ${st}@${version} not found`);
  const loaded = parseText(readFileSync(hist, "utf8"), hist);
  if (loaded.file.version !== version) throw new RuleLoadError(`${hist}: version field ${loaded.file.version} != ${version}`);
  return loaded;
}

/** States that have a current rule file. */
export function listRuleStates(opts: LoadOptions = {}): string[] {
  const dir = opts.dir ?? RULES_DIR;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => /^([A-Z]{2})\.json$/.exec(f)?.[1])
    .filter((s): s is string => Boolean(s))
    .sort();
}

/** state -> version of every current rule file (recorded on eval runs). */
export function loadedRuleVersions(opts: LoadOptions = {}): Record<string, string> {
  return Object.fromEntries(listRuleStates(opts).map((st) => [st, loadRules(st, opts).file.version]));
}

const safeName = (v: string) => v.replace(/[^A-Za-z0-9._+-]/g, "_");

/* ------------------------------------------------------------------ DB sync */

export interface SyncResult {
  state: string;
  version: string;
  sha256: string;
  rows: number;
  verified: boolean;
}

/** Upsert one state_rules row per property type present in the file. Idempotent. */
export async function syncRuleFileToDb(db: Db, loaded: LoadedRules): Promise<SyncResult> {
  const { file, sha256 } = loaded;
  let rows = 0;
  let allOk = true;
  for (const pt of PROPERTY_TYPES) {
    const rule = file.propertyTypes[pt];
    if (!rule) continue;
    const values = listRuleValuesFor(file, pt);
    const fieldSources: Record<string, unknown> = {};
    const urls = new Set<string>();
    for (const v of values) {
      fieldSources[v.path] = { sources: v.rv.sources, verified: v.rv.verified, todo: v.rv.todo ?? null };
      v.rv.sources.forEach((s) => urls.add(s.url));
    }
    const verified = allVerified(values);
    allOk &&= verified;
    const window = file.dueDiligence.windowDaysBeforeReport.value;
    const years = rule.dormancyYears.value;
    const row = {
      state: file.state,
      version: file.version,
      propertyType: pt as PropertyType,
      dormancyMonths: years === null ? null : Math.round(years * 12),
      ddWindowDaysMin: window?.min ?? null,
      ddWindowDaysMax: window?.max ?? null,
      minReportableCents: rule.minAmountCents.value,
      ruleJson: file as unknown as Record<string, unknown>,
      fieldSources,
      reportStages: file.reportStages as unknown[],
      interestRule: file.interest as unknown as Record<string, unknown>,
      sourceUrls: [...urls],
      verified,
      ruleFileSha: sha256,
    };
    await db
      .insert(stateRules)
      .values(row)
      .onConflictDoUpdate({
        target: [stateRules.state, stateRules.version, stateRules.propertyType],
        set: {
          dormancyMonths: row.dormancyMonths,
          ddWindowDaysMin: row.ddWindowDaysMin,
          ddWindowDaysMax: row.ddWindowDaysMax,
          minReportableCents: row.minReportableCents,
          ruleJson: row.ruleJson,
          fieldSources: row.fieldSources,
          reportStages: row.reportStages,
          interestRule: row.interestRule,
          sourceUrls: row.sourceUrls,
          verified: row.verified,
          ruleFileSha: row.ruleFileSha,
        },
      });
    rows++;
  }
  return { state: file.state, version: file.version, sha256, rows, verified: rows > 0 && allOk };
}

/** Sync every rules/<STATE>.json (or just `states`) into state_rules. */
export async function syncRulesToDb(db: Db, opts: LoadOptions & { states?: string[] } = {}): Promise<SyncResult[]> {
  const states = opts.states?.map(stateCode) ?? listRuleStates(opts);
  const out: SyncResult[] = [];
  for (const st of states) out.push(await syncRuleFileToDb(db, loadRules(st, opts)));
  return out;
}

/** Rebuild a RuleFile from a state_rules row (rule_json holds the whole file). */
export function ruleFileFromRow(row: { ruleJson: Record<string, unknown> }): RuleFile {
  const r = parseRuleFile(row.ruleJson);
  if (!r.ok) throw new RuleLoadError("state_rules.rule_json is not a valid rule file", r.errors);
  return r.file;
}

/* ------------------------------------------------------------------ approval */

function clone(file: RuleFile): RuleFile {
  return structuredClone(file);
}

/** Return a copy of `file` with one RuleValue marked verified. `fieldPath` is a path from listRuleValues. */
export function approveRuleField(file: RuleFile, fieldPath: string, by: string, at: string): RuleFile {
  const next = clone(file);
  const target = listRuleValues(next).find((v) => v.path === fieldPath);
  if (!target) throw new RuleLoadError(`Unknown rule field: ${fieldPath}`);
  target.rv.verified = true;
  target.rv.verified_by = by;
  target.rv.verified_at = at;
  return next;
}

/**
 * Return a copy with every RuleValue that has a non-null value marked verified. Null-valued fields stay
 * unverified unless `includeNull` (use only when a human confirmed the statute is silent on that field).
 */
export function approveRuleFile(file: RuleFile, by: string, at: string, opts: { includeNull?: boolean } = {}): RuleFile {
  const next = clone(file);
  for (const v of listRuleValues(next)) {
    if (v.rv.value === null && !opts.includeNull) continue;
    v.rv.verified = true;
    v.rv.verified_by = by;
    v.rv.verified_at = at;
  }
  return next;
}

export interface SaveOptions extends LoadOptions {
  /** Also overwrite rules/<STATE>.json with this version. Default true. */
  makeCurrent?: boolean;
}

/**
 * Persist a rule file as rules/history/<STATE>/<version>.json (never overwriting different content) and,
 * by default, as the current rules/<STATE>.json. The previous current file is archived to history first.
 * `file.version` must be new: callers bump it (e.g. "2026-11-01.approved").
 */
export function saveRuleVersion(file: RuleFile, opts: SaveOptions = {}): { sha256: string; historyPath: string } {
  const dir = opts.dir ?? RULES_DIR;
  const text = `${JSON.stringify(file, null, 2)}\n`;
  const histDir = path.join(dir, "history", file.state);
  mkdirSync(histDir, { recursive: true });

  const currentPath = path.join(dir, `${file.state}.json`);
  if (existsSync(currentPath)) {
    const curText = readFileSync(currentPath, "utf8");
    const cur = parseText(curText, currentPath).file;
    const curHist = path.join(histDir, `${safeName(cur.version)}.json`);
    if (!existsSync(curHist)) writeFileSync(curHist, curText);
  }

  const historyPath = path.join(histDir, `${safeName(file.version)}.json`);
  if (existsSync(historyPath) && readFileSync(historyPath, "utf8") !== text) {
    throw new RuleLoadError(`Refusing to overwrite existing rule version ${file.state}@${file.version}; bump the version`);
  }
  writeFileSync(historyPath, text);
  if (opts.makeCurrent !== false) writeFileSync(currentPath, text);
  return { sha256: sha256Hex(text), historyPath };
}

