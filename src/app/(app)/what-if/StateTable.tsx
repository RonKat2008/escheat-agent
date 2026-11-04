import { UnknownValue, UnverifiedBadge } from "@/components/primitives";
import { formatUSD } from "@/lib/money";
import type { Projection } from "@/lib/what-if/types";
import { cn } from "@/lib/utils";

function change(cents: number) {
  if (cents === 0) return <span className="text-fg-3">no change</span>;
  return <span className={cents > 0 ? "text-pink-400" : "text-blue-300"}>{`${cents > 0 ? "+" : "−"}${formatUSD(Math.abs(cents))}`}</span>;
}

/** Exposure and audit interest per state, today vs the simulated date. */
export function StateTable({ base, next, atLabel }: { base: Projection; next: Projection; atLabel: string }) {
  const states = [...new Set([...base.exposure.byState.map((s) => s.state), ...next.interest.byState.map((s) => s.state)])].sort();
  return (
    <div className="relative overflow-x-auto rounded-[10px] border border-line" data-testid="wi-states">
      <table className="w-full min-w-[640px] text-[13px]">
        <caption className="sr-only">Open exposure and audit interest by state, today and {atLabel}</caption>
        <thead className="bg-ink-2 text-left text-xs text-fg-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">State</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Exposure today</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Exposure {atLabel}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Audit interest {atLabel}</th>
            <th scope="col" className="px-3 py-2 font-medium">Interest rule</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {states.map((st) => {
            const b = base.exposure.byState.find((s) => s.state === st)?.cents ?? 0;
            const n = next.exposure.byState.find((s) => s.state === st)?.cents ?? 0;
            const i = next.interest.byState.find((s) => s.state === st);
            const src = i?.sources[0];
            return (
              <tr key={st} data-testid="wi-state-row" data-state={st} data-cents={n}>
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-fg-1">{st}</th>
                <td className="num px-3 py-2 text-right whitespace-nowrap text-fg-2">{formatUSD(b)}</td>
                <td className="num px-3 py-2 text-right whitespace-nowrap text-fg-1">{formatUSD(n)}</td>
                <td className="num px-3 py-2 text-right whitespace-nowrap">{change(n - b)}</td>
                <td className="px-3 py-2 text-right">
                  {!i ? (
                    <span className="text-fg-3">None owed</span>
                  ) : i.status === "unknown" || i.cents === null ? (
                    <UnknownValue reason={i.notes[0]} />
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span className={cn("num", i.cents > 0 ? "text-pink-400" : "text-fg-2")}>{formatUSD(i.cents)}</span>
                      {!i.verified ? <UnverifiedBadge compact /> : null}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-fg-3">
                  {i?.ruleVersion ? (
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <span className="font-mono">
                        {st}@{i.ruleVersion}
                      </span>
                      {i.annualRatePct !== null ? <span>· {i.annualRatePct}% p.a.</span> : null}
                      {src ? (
                        <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline underline-offset-2 hover:text-blue-200" title={src.quote}>
                          {src.title.replace(/\s*\(.*\)\s*$/, "")}
                        </a>
                      ) : null}
                    </span>
                  ) : (
                    <UnknownValue label="No rule" reason={i?.notes[0]} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
