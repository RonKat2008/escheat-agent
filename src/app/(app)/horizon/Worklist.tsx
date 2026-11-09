"use client";

import { Download } from "lucide-react";
import { Money, UnknownValue, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { ACT_NOW_DAYS } from "@/components/viz/horizon-radar/HorizonRadar";
import { addDays, type IsoDate } from "@/lib/dates";
import { formatDate, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { HorizonItem } from "@/lib/horizon/project";
import { remainingAt, splitByScope, type OutOfScopeGroup } from "@/lib/horizon/scrub";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface WorklistProps {
  items: readonly HorizonItem[];
  totalCents: number;
  activeId: string | null;
  onActive: (id: string | null) => void;
  /** Scrubber offset (days past the demo clock). Read-only projection. */
  offset: number;
  asOf: string;
  /** States with a rule file loaded; payments elsewhere are grouped as out of scope. */
  ruleStates: readonly string[];
}

const dayText = (n: number) => (n === 1 ? "1 day" : `${n} days`);

function StaleIn({ days, on }: { days: number; on: string }) {
  if (days === 0) {
    return (
      <span className="flex flex-col" data-testid="stale-in" data-days={0}>
        <span className="num font-medium text-pink-400">Stale by then</span>
        <span className="text-xs text-fg-3">since {formatDate(on)}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col" data-testid="stale-in" data-days={days}>
      <span className={cn("num font-medium", days <= ACT_NOW_DAYS ? "text-pink-400" : "text-fg-1")}>{dayText(days)}</span>
      <span className="text-xs text-fg-3">{formatDate(on)}</span>
    </span>
  );
}

function Presumed({ item }: { item: HorizonItem }) {
  if (!item.dates) return <UnknownValue reason={item.unknownReason ?? undefined} />;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="num">{formatDate(item.dates.presumedAbandoned)}</span>
      {item.dates.unverified ? <UnverifiedBadge compact /> : null}
    </span>
  );
}

const TH = "px-3 py-2 font-medium max-md:hidden";

function Rows({ items, activeId, onActive, offset }: Pick<WorklistProps, "items" | "activeId" | "onActive" | "offset">) {
  return items.map((i) => {
    const left = remainingAt(i, offset);
    return (
      <tr
        key={i.ledgerItemId}
        data-testid="worklist-row"
        data-id={i.ledgerItemId}
        data-active={activeId === i.ledgerItemId}
        data-remaining={left}
        onPointerEnter={() => onActive(i.ledgerItemId)}
        className="border-b border-line/60 last:border-0 data-[active=true]:bg-ink-3"
      >
        <th scope="row" className="px-3 py-2 font-normal">
          <span className="block text-fg-1">{i.payeeName}</span>
          <span className="text-xs text-fg-3">{PROPERTY_TYPE_LABEL[i.propertyType] ?? i.propertyType}</span>
          {/* Phone width: the columns that no longer fit move onto a second line. */}
          <span className="mt-1 block text-xs text-fg-2 md:hidden" data-testid="worklist-row-meta">
            <span className={cn("num", left === 0 || left <= ACT_NOW_DAYS ? "text-pink-400" : "text-fg-1")}>{left === 0 ? "Stale by then" : `Stale in ${dayText(left)}`}</span>
            {" · "}
            {i.ownerState ? i.ownerState : "State unknown"}
            {i.checkNumber ? ` · #${i.checkNumber}` : ""}
          </span>
        </th>
        <td className="num px-3 py-2 text-fg-2 max-md:hidden">{i.checkNumber ?? "None"}</td>
        <td className="px-3 py-2 text-right">
          <Money cents={i.amountCents} />
        </td>
        <td className="num px-3 py-2 whitespace-nowrap text-fg-2 max-md:hidden">{formatDate(i.issueDate)}</td>
        <td className="px-3 py-2 max-md:hidden">
          <StaleIn days={left} on={i.staleOn} />
        </td>
        <td className="px-3 py-2 max-md:hidden">{i.ownerState ? <span className="text-fg-1">{i.ownerState}</span> : <UnknownValue reason="No state in the payee address." />}</td>
        <td className="px-3 py-2 max-md:hidden">
          <Presumed item={i} />
        </td>
      </tr>
    );
  });
}

function WorkTable({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative overflow-x-auto glass rounded-[18px] focus-visible:outline-2 focus-visible:outline-blue-400">
      <table className="w-full text-left text-[13px] md:min-w-[880px]" data-testid={testId}>
        <thead className="border-b border-line text-xs text-fg-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Payee</th>
            <th scope="col" className={TH}>Check / ref</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
            <th scope="col" className={TH}>Issued</th>
            <th scope="col" className={TH}>Stale in</th>
            <th scope="col" className={TH}>Owner state (provisional)</th>
            <th scope="col" className={TH}>Presumed abandoned (projected)</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function groupText(g: OutOfScopeGroup): string {
  return `${g.state ?? "No state"} ${g.count}`;
}

/** The reissue worklist: soonest-to-stale first. Read-only; the export is a CSV download. */
export function Worklist({ items, totalCents, activeId, onActive, offset, asOf, ruleStates }: WorklistProps) {
  const scoped = splitByScope(items, ruleStates);
  const staleByThen = items.filter((i) => remainingAt(i, offset) === 0).length;
  const known = ruleStates.join(", ");
  return (
    <section aria-labelledby="worklist-heading" className="space-y-3" data-offset={offset}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="worklist-heading" className="text-base font-semibold text-fg-1">
            Reissue worklist
          </h2>
          <p className="text-[13px] text-fg-3" data-testid="worklist-total">
            {items.length} {items.length === 1 ? "payment" : "payments"}, <Money cents={totalCents} /> outstanding. Contact the payee, confirm details, then
            cash or reissue (for example by ACH) before the stale line.
          </p>
          {offset > 0 ? (
            <p className="text-[13px] text-fg-2" data-testid="worklist-projection">
              At +{offset} days ({formatDate(addDays(asOf as IsoDate, offset))}): {staleByThen} of {items.length} would already be stale. Projection only; nothing is saved.
            </p>
          ) : null}
        </div>
        <a href="/api/horizon.csv" download className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")} data-testid="horizon-export">
          <Download aria-hidden className="size-4" />
          Export reissue worklist (CSV)
        </a>
      </div>

      <p className="text-xs text-fg-3" data-testid="worklist-in-scope">
        {scoped.inScope.length} {scoped.inScope.length === 1 ? "payment" : "payments"} in states with rules loaded ({known || "none"}).
      </p>
      <WorkTable label="Reissue worklist table" testId="worklist">
        <Rows items={scoped.inScope} activeId={activeId} onActive={onActive} offset={offset} />
      </WorkTable>

      {scoped.outOfScope.length > 0 ? (
        <details className="rounded-[10px] border border-dashed border-line-strong bg-ink-1/60 p-3" data-testid="worklist-out-of-scope" data-count={scoped.outOfScope.length} data-cents={scoped.outOfScopeCents}>
          <summary className="cursor-pointer text-[13px] text-fg-1">
            {scoped.outOfScope.length} {scoped.outOfScope.length === 1 ? "payment" : "payments"}, {formatUSD(scoped.outOfScopeCents)}: states not covered yet
          </summary>
          <p className="mt-2 mb-3 max-w-3xl text-xs text-fg-2" data-testid="worklist-out-of-scope-note">
            Rules are not loaded for these owner states ({scoped.groups.map(groupText).join(", ")}), or the payee address has no state, so this app shows no
            legal dates for them and cannot file them. They still need a reissue. Nothing here is guessed; a rules file for the state is what unlocks them.
          </p>
          <WorkTable label="Payments in states not covered yet" testId="worklist-out-of-scope-table">
            <Rows items={scoped.outOfScope} activeId={activeId} onActive={onActive} offset={offset} />
          </WorkTable>
        </details>
      ) : null}
    </section>
  );
}
