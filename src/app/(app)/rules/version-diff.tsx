import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { RuleFieldChange } from "@/lib/rules/diff";
import { describeValue, fieldMeta } from "./format";

const KIND: Record<string, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Value changed",
  sources_only: "Sources changed",
  verification_only: "Verified",
};

const show = (path: string, v: unknown) => (v === undefined ? "none" : (describeValue(path, v) ?? "Unknown"));

const TH = "text-left text-xs font-normal text-fg-3";

export function VersionDiff({ state, versions, from, to, changes }: { state: string; versions: string[]; from: string; to: string; changes: RuleFieldChange[] | null }) {
  const link = (f: string, t: string) => `/rules?state=${state}&from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
        <h3 className="font-medium text-fg-1">Compare</h3>
        <span className="font-mono text-xs text-fg-3">{from}</span>
        <ArrowRight className="size-3.5 text-fg-3" strokeWidth={1.5} aria-hidden />
        <span className="font-mono text-xs text-fg-1">{to}</span>
        {versions.length > 2 ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1 sm:ml-auto">
            {versions.slice(1, 5).map((v) => (
              <Link key={v} href={link(v, versions[0]!)} className="rounded-sm text-xs text-blue-400 underline-offset-2 transition-colors duration-150 hover:text-blue-300 hover:underline">
                vs <span className="font-mono">{v.length > 22 ? `${v.slice(0, 21)}…` : v}</span>
              </Link>
            ))}
          </span>
        ) : null}
      </div>
      {changes === null ? (
        <p className="text-[13px] text-fg-3">One of these versions could not be loaded.</p>
      ) : changes.length === 0 ? (
        <p className="text-[13px] text-fg-3">No differences between these versions.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="shadow-[inset_0_-1px_0_var(--color-line)]">
                <th scope="col" className={`h-9 pr-3 ${TH}`}>Field</th>
                <th scope="col" className={`px-3 ${TH}`}>Change</th>
                <th scope="col" className={`px-3 ${TH}`}>Before</th>
                <th scope="col" className={`pl-3 ${TH}`}>After</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => {
                const m = fieldMeta(c.path);
                return (
                  <tr key={c.path} className="border-b border-line align-top">
                    <td className="py-2.5 pr-3">
                      <span className="text-fg-1">{m.label}</span>
                      <span className="block text-xs text-fg-3">{m.group}</span>
                    </td>
                    <td className="px-3 py-2.5 text-fg-2">{KIND[c.kind]}</td>
                    <td className="px-3 py-2.5 text-fg-3">
                      <span className="line-through decoration-fg-3/60">{show(c.path, c.before)}</span>
                      {c.beforeVerified === false ? <span className="ml-1.5 text-xs">unverified</span> : null}
                    </td>
                    <td className="py-2.5 pl-3 text-fg-1">
                      {show(c.path, c.after)}
                      {c.afterVerified ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-fg-2">
                          <CheckCircle2 className="size-3.5 text-blue-500" strokeWidth={1.75} aria-hidden />
                          verified
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
