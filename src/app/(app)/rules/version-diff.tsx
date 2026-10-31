import Link from "next/link";
import { ArrowRight } from "lucide-react";
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

export function VersionDiff({ state, versions, from, to, changes }: { state: string; versions: string[]; from: string; to: string; changes: RuleFieldChange[] | null }) {
  const link = (f: string, t: string) => `/rules?state=${state}&from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <h3 className="font-medium">Compare</h3>
        <span className="font-mono text-xs text-muted-foreground">{from}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-xs">{to}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {versions.slice(1, 5).map((v) => (
            <Link key={v} href={link(v, versions[0]!)} className="rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-raised hover:text-foreground">
              vs {v.length > 22 ? `${v.slice(0, 21)}…` : v}
            </Link>
          ))}
        </span>
      </div>
      {changes === null ? (
        <p className="text-sm text-muted-foreground">One of these versions could not be loaded.</p>
      ) : changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No differences between these versions.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="text-left text-xs text-fg-3">
                <th scope="col" className="h-8 px-3 font-medium">Field</th>
                <th scope="col" className="px-3 font-medium">Change</th>
                <th scope="col" className="px-3 font-medium">Before</th>
                <th scope="col" className="px-3 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => {
                const m = fieldMeta(c.path);
                return (
                  <tr key={c.path} className="border-t border-border align-top">
                    <td className="px-3 py-2">{m.group} · {m.label}</td>
                    <td className="px-3 py-2 text-muted-foreground">{KIND[c.kind]}</td>
                    <td className="bg-pink-900/40 px-3 py-2 font-mono text-pink-300"><span className="line-through">{show(c.path, c.before)}</span>{c.beforeVerified === false ? <span className="ml-1.5 text-pink-400">unverified</span> : null}</td>
                    <td className="bg-blue-900/60 px-3 py-2 font-mono text-blue-300">{show(c.path, c.after)}{c.afterVerified ? <span className="ml-1.5 text-blue-300">verified</span> : null}</td>
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
