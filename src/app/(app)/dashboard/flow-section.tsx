import { InstrumentLabel, SyntheticChip } from "@/components/primitives";
import { SrTable } from "@/components/viz/core";
import { formatDate, plural } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { pinkCaptionText, type MoneyFlow } from "@/lib/queries/flow";
import { loadDashboard } from "./data";
import { FlowPlayer } from "./FlowPlayer";

const RECOVERY_LAYOUT = { scalePx: 40, minCard: 44, padY: 4 } as const;

/** One line for the ledger split the diagram no longer draws (R4-07): it would dwarf the money that matters. */
function LedgerCaption({ ledger }: { ledger: MoneyFlow["ledger"] }) {
  if (!ledger.known) {
    return (
      <p data-testid="flow-starts-at-stale" className="mt-3 flex items-center gap-2 text-xs text-fg-2">
        <span aria-hidden className="size-2 rounded-full border border-dashed border-fg-3" />
        No cleared or voided checks were imported, so the ledger total is unknown. The diagram starts at Stale.
      </p>
    );
  }
  return (
    <p data-testid="flow-ledger" className="mt-3 text-xs text-fg-2">
      Ledger <span className="num text-fg-1">{formatUSD(ledger.total.cents)}</span> ({plural(ledger.total.count, "check")}):{" "}
      <span className="num">{formatUSD(ledger.cleared.cents)}</span> cleared or voided
      {ledger.notStale.count > 0 ? (
        <>
          , <span className="num">{formatUSD(ledger.notStale.cents)}</span> outstanding but not yet stale
        </>
      ) : null}
      , <span className="num text-fg-1">{formatUSD(ledger.stale.cents)}</span> stale. The diagram follows the stale money.
    </p>
  );
}

/** Where the stale money is right now (§4.2), from getMoneyFlow. Band width is money; bands and cards open Items. */
export async function MoneyFlowSection() {
  const { flow, exposure } = await loadDashboard();
  const main = { nodes: flow.nodes.filter((n) => n.band === "main"), links: flow.links.filter((l) => l.band === "main") };
  const rec = { nodes: flow.nodes.filter((n) => n.band === "recovery"), links: flow.links.filter((l) => l.band === "recovery") };
  const label = (id: string) => flow.nodes.find((n) => n.id === id)?.label ?? id;
  if (main.links.length === 0) return null;
  const interest = flow.late?.interest ?? null;
  return (
    <section aria-labelledby="flow-h" data-testid="money-flow" className="relative mt-14 min-w-0 overflow-x-clip">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <InstrumentLabel as="h2" id="flow-h">
            Money flow
          </InstrumentLabel>
          <p className="mt-1.5 max-w-prose text-[13px] text-fg-2">
            Where the stale money is as of {formatDate(flow.asOf)}. Band width is the amount. The <span className="text-fg-1">At risk</span> states add up to{" "}
            <span data-testid="flow-exposure" className="num text-fg-1">
              {formatUSD(flow.exposure.cents)}
            </span>
            , the total above.
            {" "}
            <span data-testid="flow-pink-caption">{pinkCaptionText(flow)}</span> Click a band or a card to open those items.
          </p>
        </div>
        <SyntheticChip />
      </div>
      <LedgerCaption ledger={flow.ledger} />
      {flow.late ? (
        <p data-testid="flow-late" className="mt-1.5 text-xs text-fg-2">
          <span className="text-pink-300">Late</span> <span className="num text-fg-1">{formatUSD(flow.late.cents)}</span> ({plural(flow.late.count, "item")}
          {flow.late.remitLate.count > 0 ? (
            <>
              : <span className="num">{flow.late.count - flow.late.remitLate.count}</span> not yet reported, <span className="num">{flow.late.remitLate.count}</span> reported with
              the remittance late
            </>
          ) : null}
          )
          {interest?.cents != null ? (
            <>
              {" "}
              plus ~<span className="num text-fg-1">{formatUSD(interest.cents)}</span> interest on these items from the rules engine
              {interest.verified ? "" : " (UNVERIFIED rule values)"}
            </>
          ) : null}
          {interest && interest.unknownStates.length > 0 ? <> · no interest rule for {interest.unknownStates.join(", ")}, so no rate is assumed</> : null}.
        </p>
      ) : null}
      <div className="glass mt-5 rounded-[22px] px-3 py-4 sm:px-5">
        <FlowPlayer nodes={main.nodes} links={main.links} lateInterest={interest} drawAtMs={600} label="Money flow from stale items to owner states to what happens next" />
        {rec.links.length > 0 ? (
          <div className="mt-4 border-t border-line pt-3" data-testid="recovery-band">
            <InstrumentLabel as="p">Recovered from state portals</InstrumentLabel>
            <FlowPlayer nodes={rec.nodes} links={rec.links} layout={RECOVERY_LAYOUT} drawAtMs={1000} label="Money recovered from state portals" className="mt-2" />
          </div>
        ) : null}
      </div>
      <SrTable
        caption={`Money flow as of ${formatDate(flow.asOf)}; open exposure ${formatUSD(exposure.totalCents)}`}
        columns={["From", "To", "Amount", "Items", "Needs you"]}
        rows={flow.links.map((l) => [label(l.source), label(l.target), formatUSD(l.cents), String(l.count), l.tone === "late" ? "Yes, late" : l.tone === "human" ? "Yes" : "No"])}
      />
    </section>
  );
}
