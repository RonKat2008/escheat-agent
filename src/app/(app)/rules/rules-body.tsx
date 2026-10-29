import Link from "next/link";
import { EmptyState, SourceLink, UnknownBadge, UnverifiedBadge, VerifiedMark } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import { cn } from "@/lib/utils";
import type { RuleFile } from "../../../../rules/schema";
import { ApproveButton } from "./approve-button";
import { diffVersions, listStates, listVersions, loadCurrent } from "./data";
import { VersionDiff } from "./version-diff";
import { describeValue, fieldMeta } from "./format";

export async function RulesBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const states = listStates();
  if (states.length === 0) return <EmptyState title="No rule files found" description="Rule files live in rules/<STATE>.json." />;
  const state = states.find((s) => s.state === one("state")?.toUpperCase())?.state ?? states[0]!.state;
  const file = loadCurrent(state);
  if (!file) return <EmptyState title={`No rules loaded for ${state}`} description="The rule file is missing or invalid, so every date for this state is UNKNOWN." />;
  const versions = listVersions(state);
  const from = one("from") ?? versions[1]?.version ?? null;
  const to = one("to") ?? versions[0]?.version ?? null;
  const changes = from && to && from !== to ? diffVersions(state, from, to) : null;
  return (
    <div className="space-y-6">
      <nav aria-label="State" className="flex flex-wrap gap-2">
        {states.map((s) => (
          <Link
            key={s.state}
            href={`/rules?state=${s.state}`}
            aria-current={s.state === state ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm transition-colors duration-150",
              s.state === state ? "border-strong bg-raised text-foreground" : "border-border text-muted-foreground hover:bg-raised hover:text-foreground",
            )}
          >
            <span className="font-mono font-medium">{s.state}</span>
            {s.unverified > 0 ? (
              <span className="rounded-md border border-dashed border-at-risk/70 px-1.5 font-mono text-[11px] text-at-risk">{s.unverified} unverified</span>
            ) : (
              <span className="text-xs text-resolved">All verified</span>
            )}
          </Link>
        ))}
      </nav>
      <FieldTable file={file} state={state} sha256={tryLoadRules(state)?.sha256 ?? ""} />
      <section aria-labelledby="hist-h" className="rounded-[14px] border border-border bg-surface">
        <h2 id="hist-h" className="px-5 pt-4 text-[15px] font-semibold">Version history</h2>
        <ul className="divide-y divide-border px-5 pb-2">
          {versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="font-mono text-[13px]">{v.version}</span>
              {v.current ? <span className="rounded-md bg-raised px-1.5 py-0.5 text-xs">Current</span> : null}
              <span className="text-muted-foreground">
                {v.verifiedCount}/{v.fieldCount} verified
                {v.verifiedBy.length ? ` by ${v.verifiedBy.join(", ")}` : ""}
              </span>
              {v.researchedAt ? <span className="ml-auto text-xs text-muted-foreground">researched {formatDate(v.researchedAt.slice(0, 10))}</span> : null}
            </li>
          ))}
        </ul>
        {versions.length > 1 && from && to ? (
          <VersionDiff state={state} versions={versions.map((v) => v.version)} from={from} to={to} changes={changes} />
        ) : (
          <p className="px-5 pb-5 text-sm text-muted-foreground">There is one version so far. Approving values saves a new version you can compare here.</p>
        )}
      </section>
    </div>
  );
}

function FieldTable({ file, state, sha256 }: { file: RuleFile; state: string; sha256: string }) {
  const values = listRuleValues(file);
  const groups = new Map<string, { order: number; rows: { path: string; label: string; rv: (typeof values)[number]["rv"] }[] }>();
  for (const v of values) {
    const m = fieldMeta(v.path);
    const g = groups.get(m.group) ?? { order: m.order, rows: [] };
    g.rows.push({ path: v.path, label: m.label, rv: v.rv });
    groups.set(m.group, g);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].order - b[1].order);
  const approvable = values.filter((v) => !v.rv.verified && v.rv.value !== null).length;
  const unverified = values.filter((v) => !v.rv.verified).length;
  const extras = (["electronicFormat", "portal"] as const).flatMap((k) => {
    const raw = (file as Record<string, unknown>)[k];
    return raw && typeof raw === "object" ? [{ key: k, rv: raw as { value?: unknown; sources?: { url: string; title?: string; quote?: string }[]; verified?: boolean; todo?: string } }] : [];
  });
  return (
    <section aria-label={`${state} rule values`} className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">
            {state} rule values <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{file.version}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {unverified === 0 ? "Every value is verified." : `${unverified} of ${values.length} values are not verified.`} Values with no value stay unknown until researched.
          </p>
        </div>
        {approvable > 0 ? (
          <ApproveButton state={state} expectedVersion={file.version} expectedSha256={sha256} label={`Approve all with a value (${approvable})`} subject={`${approvable} ${state} rule values`} count={approvable} variant="default" />
        ) : null}
      </div>
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <thead>
            <tr className="text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <th scope="col" className="h-9 w-[20%] px-5 font-medium">Field</th>
              <th scope="col" className="w-[30%] px-3 font-medium">Value</th>
              <th scope="col" className="px-3 font-medium">Sources</th>
              <th scope="col" className="w-[112px] px-3 font-medium">Status</th>
              <th scope="col" className="w-[104px] px-3 text-right font-medium"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          {ordered.map(([group, g]) => (
            <tbody key={group} className="border-t border-border">
              <tr>
                <th colSpan={5} scope="colgroup" className="bg-background/50 px-5 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {group}
                </th>
              </tr>
              {g.rows.map((r) => {
                const text = describeValue(r.path, r.rv.value);
                return (
                  <tr key={r.path} data-field={r.path} className="border-t border-border align-top">
                    <td className="px-5 py-3">{r.label}</td>
                    <td className="px-3 py-3">
                      {text === null ? (
                        <div className="space-y-1.5">
                          <span className="text-muted-foreground italic">Unknown</span>
                          {r.rv.todo ? <p className="max-w-xs text-xs text-muted-foreground">TODO: {r.rv.todo}</p> : null}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <span className="font-mono text-[13px] break-words">{text}</span>
                          {r.rv.todo ? <p className="max-w-xs text-xs text-muted-foreground">TODO: {r.rv.todo}</p> : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.rv.sources.length === 0 ? (
                        <span className="text-muted-foreground">No source</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1.5">
                          {dedupe(r.rv.sources).slice(0, 3).map((s) => (
                            <SourceLink key={s.url + s.quote} url={s.url} title={s.title} quote={s.quote} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.rv.verified ? (
                        <div className="space-y-0.5">
                          <VerifiedMark />
                          {r.rv.verified_by ? <p className="text-xs text-muted-foreground">{r.rv.verified_by}{r.rv.verified_at ? `, ${formatDate(r.rv.verified_at.slice(0, 10))}` : ""}</p> : null}
                        </div>
                      ) : text === null ? (
                        <div className="flex flex-col items-start gap-1.5"><UnverifiedBadge /><UnknownBadge /></div>
                      ) : (
                        <UnverifiedBadge />
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {!r.rv.verified && text !== null ? (
                        <ApproveButton state={state} path={r.path} expectedVersion={file.version} expectedSha256={sha256} label="Approve" subject={`${r.label.toLowerCase()} (${group})`} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
          {extras.length > 0 ? (
            <tbody className="border-t border-border">
              <tr>
                <th colSpan={5} scope="colgroup" className="bg-background/50 px-5 py-2 text-left text-xs font-semibold text-muted-foreground">Format and portal (reference only)</th>
              </tr>
              {extras.map(({ key, rv }) => (
                <tr key={key} className="border-t border-border align-top">
                  <td className="px-5 py-3">{key === "portal" ? "Filing portal" : "Electronic file format"}</td>
                  <td colSpan={2} className="px-3 py-3">
                    <p className="max-w-prose font-mono text-[13px] break-words">{typeof rv.value === "string" ? rv.value : rv.value ? JSON.stringify(rv.value) : "Unknown"}</p>
                    {rv.sources?.[0] ? <div className="mt-1.5"><SourceLink url={rv.sources[0].url} title={rv.sources[0].title ?? rv.sources[0].url} quote={rv.sources[0].quote ?? ""} /></div> : null}
                  </td>
                  <td className="px-3 py-3">{rv.verified ? <VerifiedMark /> : <UnverifiedBadge />}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
      <FieldCards ordered={ordered} extras={extras} state={state} version={file.version} sha256={sha256} />
      {file.notes.length > 0 ? (
        <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Research notes</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {file.notes.slice(0, 5).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type FieldRow = { path: string; label: string; rv: ReturnType<typeof listRuleValues>[number]["rv"] };
type Extra = { key: string; rv: { value?: unknown; sources?: { url: string; title?: string; quote?: string }[]; verified?: boolean } };

/** Below md: one stacked card per rule field, so nothing scrolls sideways and Approve stays visible. */
function FieldCards({ ordered, extras, state, version, sha256 }: { ordered: [string, { rows: FieldRow[] }][]; extras: Extra[]; state: string; version: string; sha256: string }) {
  return (
    <div className="md:hidden">
      {ordered.map(([group, g]) => (
        <section key={group} aria-label={group} className="border-t border-border">
          <h3 className="bg-background/50 px-4 py-2 text-xs font-semibold text-muted-foreground">{group}</h3>
          <ul className="divide-y divide-border">
            {g.rows.map((r) => {
              const text = describeValue(r.path, r.rv.value);
              const sources = dedupe(r.rv.sources).slice(0, 3);
              return (
                <li key={r.path} data-field-card={r.path} className="space-y-3 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm font-medium">{r.label}</p>
                    <div className="shrink-0">
                      {r.rv.verified ? <VerifiedMark /> : text === null ? <span className="inline-flex flex-wrap justify-end gap-1.5"><UnverifiedBadge /><UnknownBadge /></span> : <UnverifiedBadge />}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {text === null ? <p className="text-sm text-muted-foreground italic">Unknown</p> : <p className="font-mono text-[13px] break-words">{text}</p>}
                    {r.rv.todo ? <p className="text-xs text-muted-foreground">TODO: {r.rv.todo}</p> : null}
                    {r.rv.verified && r.rv.verified_by ? (
                      <p className="text-xs text-muted-foreground">Verified by {r.rv.verified_by}{r.rv.verified_at ? `, ${formatDate(r.rv.verified_at.slice(0, 10))}` : ""}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sources.length === 0 ? <span className="text-xs text-muted-foreground">No source</span> : sources.map((s) => <SourceLink key={s.url + s.quote} url={s.url} title={s.title} quote={s.quote} />)}
                  </div>
                  {!r.rv.verified && text !== null ? (
                    <ApproveButton className="h-10 w-full" state={state} path={r.path} expectedVersion={version} expectedSha256={sha256} label="Approve" subject={`${r.label.toLowerCase()} (${group})`} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {extras.length > 0 ? (
        <section aria-label="Format and portal" className="border-t border-border">
          <h3 className="bg-background/50 px-4 py-2 text-xs font-semibold text-muted-foreground">Format and portal (reference only)</h3>
          <ul className="divide-y divide-border">
            {extras.map(({ key, rv }) => (
              <li key={key} className="space-y-2 px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{key === "portal" ? "Filing portal" : "Electronic file format"}</p>
                  {rv.verified ? <VerifiedMark /> : <UnverifiedBadge />}
                </div>
                <p className="font-mono text-[13px] break-words">{typeof rv.value === "string" ? rv.value : rv.value ? JSON.stringify(rv.value) : "Unknown"}</p>
                {rv.sources?.[0] ? <SourceLink url={rv.sources[0].url} title={rv.sources[0].title ?? rv.sources[0].url} quote={rv.sources[0].quote ?? ""} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function dedupe(s: { url: string; title?: string; quote?: string }[]) {
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
