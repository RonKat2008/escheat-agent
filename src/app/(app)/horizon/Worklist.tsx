"use client";

import { Download } from "lucide-react";
import { Money, UnknownValue, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { ACT_NOW_DAYS } from "@/components/viz/horizon-radar/HorizonRadar";
import { formatDate, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { HorizonItem } from "@/lib/horizon/project";
import { cn } from "@/lib/utils";

export interface WorklistProps {
  items: readonly HorizonItem[];
  totalCents: number;
  activeId: string | null;
  onActive: (id: string | null) => void;
}

function StaleIn({ days, on }: { days: number; on: string }) {
  const urgent = days <= ACT_NOW_DAYS;
  return (
    <span className="flex flex-col">
      <span className={cn("num font-medium", urgent ? "text-pink-400" : "text-fg-1")}>{days === 1 ? "1 day" : `${days} days`}</span>
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

/** The reissue worklist: soonest-to-stale first. Read-only; the export is a CSV download. */
export function Worklist({ items, totalCents, activeId, onActive }: WorklistProps) {
  return (
    <section aria-labelledby="worklist-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="worklist-heading" className="text-base font-semibold text-fg-1">
            Reissue worklist
          </h2>
          <p className="text-[13px] text-fg-3" data-testid="worklist-total">
            {items.length} {items.length === 1 ? "payment" : "payments"}, <Money cents={totalCents} /> outstanding. Contact the payee, confirm details, then
            cash or reissue (for example by ACH) before the stale line.
          </p>
        </div>
        <a href="/api/horizon.csv" download className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")} data-testid="horizon-export">
          <Download aria-hidden className="size-4" />
          Export reissue worklist (CSV)
        </a>
      </div>
      <div role="region" aria-label="Reissue worklist table" tabIndex={0} className="relative overflow-x-auto rounded-[10px] border border-line bg-ink-1 focus-visible:outline-2 focus-visible:outline-blue-400">
        <table className="w-full min-w-[880px] text-left text-[13px]" data-testid="worklist">
          <thead className="border-b border-line text-xs text-fg-3">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Payee</th>
              <th scope="col" className="px-3 py-2 font-medium">Check / ref</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
              <th scope="col" className="px-3 py-2 font-medium">Issued</th>
              <th scope="col" className="px-3 py-2 font-medium">Stale in</th>
              <th scope="col" className="px-3 py-2 font-medium">Owner state (provisional)</th>
              <th scope="col" className="px-3 py-2 font-medium">Presumed abandoned (projected)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.ledgerItemId}
                data-testid="worklist-row"
                data-id={i.ledgerItemId}
                data-active={activeId === i.ledgerItemId}
                onPointerEnter={() => onActive(i.ledgerItemId)}
                className="border-b border-line/60 last:border-0 data-[active=true]:bg-ink-3"
              >
                <th scope="row" className="px-3 py-2 font-normal">
                  <span className="block text-fg-1">{i.payeeName}</span>
                  <span className="text-xs text-fg-3">{PROPERTY_TYPE_LABEL[i.propertyType] ?? i.propertyType}</span>
                </th>
                <td className="num px-3 py-2 text-fg-2">{i.checkNumber ?? "None"}</td>
                <td className="px-3 py-2 text-right">
                  <Money cents={i.amountCents} />
                </td>
                <td className="num px-3 py-2 whitespace-nowrap text-fg-2">{formatDate(i.issueDate)}</td>
                <td className="px-3 py-2">
                  <StaleIn days={i.daysUntilStale} on={i.staleOn} />
                </td>
                <td className="px-3 py-2">{i.ownerState ? <span className="text-fg-1">{i.ownerState}</span> : <UnknownValue reason="No state in the payee address." />}</td>
                <td className="px-3 py-2">
                  <Presumed item={i} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
