import Link from "next/link";
import { ShieldQuestion } from "lucide-react";
import { EmptyState, Section, UnverifiedBanner } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import { cn } from "@/lib/utils";
import type { RuleFile } from "../../../../rules/schema";
import { ApproveButton } from "./approve-button";
import { diffVersions, fieldHistory, listStates, listVersions, loadCurrent, type FieldVersion, type StateSummary, type VersionInfo } from "./data";
import { describeValue, fieldMeta } from "./format";
import { RulesTable } from "./rules-table";
import type { RuleGroup, RuleRow, RuleSourceView } from "./rules-types";
import { VersionDiff } from "./version-diff";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function RulesBody({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const states = listStates();
  if (states.length === 0) return <EmptyState title="No rule files found" description="Rule files live in rules/<STATE>.json." />;
  const state = states.find((s) => s.state === one("state")?.toUpperCase())?.state ?? states[0]!.state;
  const file = loadCurrent(state);
  if (!file) return <EmptyState title={`No rules loaded for ${state}`} description="The rule file is missing or invalid, so every date for this state is UNKNOWN." />;
  const sha256 = tryLoadRules(state)?.sha256 ?? "";
  const versions = listVersions(state);
  const from = one("from") ?? versions[1]?.version ?? null;
  const to = one("to") ?? versions[0]?.version ?? null;
  const changes = from && to && from !== to ? diffVersions(state, from, to) : null;
  const groups = buildGroups(file, fieldHistory(state));
  const values = listRuleValues(file);
  const approvable = values.filter((v) => !v.rv.verified && v.rv.value !== null).length;
  const unverified = values.filter((v) => !v.rv.verified).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse gap-4 md:flex-row md:items-center md:justify-between md:border-b md:border-line">
        <StateTabs states={states} current={state} />
        {approvable > 0 ? (
          <ApproveButton
            state={state}
            expectedVersion={file.version}
            expectedSha256={sha256}
            label={`Approve all with a value (${approvable})`}
            subject={`${approvable} ${state} rule values`}
            count={approvable}
            variant="default"
            className="self-start md:self-auto"
          />
        ) : null}
      </div>

      {unverified > 0 ? (
        <UnverifiedBanner>
          {unverified} of {values.length} {state} values are unverified, so every date that depends on them is provisional. Values marked{" "}
          <ShieldQuestion className="inline size-3.5 -translate-y-px" strokeWidth={1.75} aria-label="with a shield" /> need a human check against
          their source. Open a row for its sources, quoted text and research note.
        </UnverifiedBanner>
      ) : null}

      <div>
        <p className="mb-2 text-[13px] text-fg-3">
          {state} rule file <span className="font-mono text-xs text-fg-2">{file.version}</span>
          {file.researched_at ? <>, researched <span className="num">{formatDate(file.researched_at.slice(0, 10))}</span></> : null}. A field with no value stays
          unknown until researched.
        </p>
        <RulesTable state={state} version={file.version} sha256={sha256} groups={groups} />
      </div>

      {file.notes.length > 0 ? (
        <Section id="notes" className="pt-6" title="Research notes" meta="From the researcher, not legal advice">
          <ul className="max-w-3xl space-y-2 text-[13px] leading-5 text-fg-3">
            {file.notes.slice(0, 5).map((n) => (
              <li key={n} className="text-pretty">
                {n}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="hist" className="pt-6" title="Version history" meta={`${versions.length} ${versions.length === 1 ? "version" : "versions"}`}>
        <VersionTable versions={versions} />
        {versions.length > 1 && from && to ? (
          <VersionDiff state={state} versions={versions.map((v) => v.version)} from={from} to={to} changes={changes} />
        ) : (
          <p className="mt-3 text-[13px] text-fg-3">There is one version so far. Approving values saves a new version you can compare here.</p>
        )}
      </Section>
    </div>
  );
}

function StateTabs({ states, current }: { states: StateSummary[]; current: string }) {
  return (
    <nav aria-label="State" className="-mb-px flex gap-6 border-b border-line md:border-b-0">
      {states.map((s) => {
        const active = s.state === current;
        const verified = s.total - s.unverified;
        return (
          <Link
            key={s.state}
            href={`/rules?state=${s.state}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-10 items-center gap-2 rounded-sm text-[13px] transition-colors duration-150",
              "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-blue-500 after:opacity-0 after:transition-opacity after:duration-150",
              active ? "text-fg-1 after:opacity-100" : "text-fg-3 hover:text-fg-1",
            )}
          >
            <span className="font-medium">{s.state}</span>
            <span className={cn("num text-xs", active ? "text-fg-2" : "text-fg-3")}>
              {verified} / {s.total}
              <span className="hidden sm:inline"> verified</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function VersionTable({ versions }: { versions: VersionInfo[] }) {
  return (
    <table className="w-full table-fixed text-[13px]">
      <thead>
        <tr className="shadow-[inset_0_-1px_0_var(--color-line)]">
          <th scope="col" className="h-9 pr-3 text-left text-xs font-normal text-fg-3">
            Version
          </th>
          <th scope="col" className="px-3 text-left text-xs font-normal text-fg-3">
            Values verified
          </th>
          <th scope="col" className="hidden w-[150px] pl-3 text-right text-xs font-normal text-fg-3 sm:table-cell">
            Researched
          </th>
        </tr>
      </thead>
      <tbody>
        {versions.map((v) => (
          <tr key={v.version} className="border-b border-line">
            <td className="h-10 truncate pr-3 align-middle">
              <span className="font-mono text-xs text-fg-1">{v.version}</span>
              {v.current ? <span className="ml-2 text-xs text-fg-3">Current</span> : null}
            </td>
            <td className="truncate px-3 align-middle text-fg-2">
              <span className="num">
                {v.verifiedCount}/{v.fieldCount} verified{v.verifiedBy.length ? ` by ${v.verifiedBy.join(", ")}` : ""}
              </span>
            </td>
            <td className="num hidden pl-3 text-right align-middle text-fg-3 sm:table-cell">{v.researchedAt ? formatDate(v.researchedAt.slice(0, 10)) : "Unknown"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type RawSource = { url: string; title?: string; quote?: string };

function dedupe(s: RawSource[]): RuleSourceView[] {
  const seen = new Set<string>();
  return s
    .filter((x) => {
      const k = x.url + (x.quote ?? "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((x) => ({ url: x.url, title: x.title ?? x.url, quote: x.quote ?? "" }));
}

/** Sentence-case the human text unless it is a code (codes keep their exact spelling). */
const display = (text: string | null, code: boolean) => (text === null || code ? text : text.charAt(0).toUpperCase() + text.slice(1));

const isCode = (p: string) => p.endsWith(".naupaCode");

function historyView(p: string, list: FieldVersion[] | undefined): RuleRow["history"] {
  return (list ?? []).map((h) => ({
    version: h.version,
    current: h.current,
    value: display(describeValue(p, h.value), isCode(p)),
    verified: h.verified,
    verifiedBy: h.verifiedBy,
    verifiedAt: h.verifiedAt,
  }));
}

function buildGroups(file: RuleFile, history: Record<string, FieldVersion[]>): RuleGroup[] {
  const groups = new Map<string, { order: number; rows: RuleRow[] }>();
  for (const { path: p, rv } of listRuleValues(file)) {
    const m = fieldMeta(p);
    const g = groups.get(m.group) ?? { order: m.order, rows: [] };
    const code = isCode(p);
    const value = display(describeValue(p, rv.value), code);
    g.rows.push({
      path: p,
      label: m.label,
      group: m.group,
      value,
      code,
      verified: rv.verified,
      verifiedBy: rv.verified_by ?? null,
      verifiedAt: rv.verified_at ?? null,
      todo: rv.todo ?? null,
      sources: dedupe(rv.sources),
      approvable: !rv.verified && value !== null,
      reference: false,
      history: historyView(p, history[p]),
    });
    groups.set(m.group, g);
  }
  const ordered: RuleGroup[] = [...groups.entries()].sort((a, b) => a[1].order - b[1].order).map(([name, g]) => ({ name, rows: g.rows }));

  const reference = (["electronicFormat", "portal"] as const).flatMap((k): RuleRow[] => {
    const raw = (file as Record<string, unknown>)[k];
    if (!raw || typeof raw !== "object") return [];
    const rv = raw as { value?: unknown; sources?: RawSource[]; verified?: boolean; todo?: string; verified_by?: string; verified_at?: string };
    const value = typeof rv.value === "string" ? rv.value : rv.value ? JSON.stringify(rv.value) : null;
    return [
      {
        path: k,
        label: k === "portal" ? "Filing portal" : "Electronic file format",
        group: "Format and portal",
        value,
        code: false,
        verified: rv.verified === true,
        verifiedBy: rv.verified_by ?? null,
        verifiedAt: rv.verified_at ?? null,
        todo: rv.todo ?? null,
        sources: dedupe(rv.sources ?? []),
        approvable: false,
        reference: true,
        history: [],
      },
    ];
  });
  return reference.length > 0 ? [...ordered, { name: "Format and portal", rows: reference }] : ordered;
}
