import { InstrumentLabel, SyntheticChip } from "@/components/primitives";
import { SrTable } from "@/components/viz/core";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { loadDashboard } from "./data";
import { FlowPlayer } from "./FlowPlayer";

/** Where every ledger dollar is right now (§4.2), from getMoneyFlow. Link width is money; pink bands need you. */
export async function MoneyFlowSection() {
  const { flow, exposure } = await loadDashboard();
  const main = { nodes: flow.nodes.filter((n) => n.band === "main"), links: flow.links.filter((l) => l.band === "main") };
  const rec = { nodes: flow.nodes.filter((n) => n.band === "recovery"), links: flow.links.filter((l) => l.band === "recovery") };
  const label = (id: string) => flow.nodes.find((n) => n.id === id)?.label ?? id;
  if (main.links.length === 0) return null;
  return (
    <section aria-labelledby="flow-h" data-testid="money-flow" className="mt-14 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <InstrumentLabel as="h2" id="flow-h">
            Money flow
          </InstrumentLabel>
          <p className="mt-1.5 max-w-prose text-[13px] text-fg-2">
            Where every ledger dollar is as of {formatDate(flow.asOf)}. Band width is the amount. The <span className="text-fg-1">At risk</span> states add up to{" "}
            <span data-testid="flow-exposure" className="num text-fg-1">
              {formatUSD(flow.exposure.cents)}
            </span>
            , the total above. Pink bands need a person: a deadline within 7 days or a letter awaiting approval.
          </p>
        </div>
        <SyntheticChip />
      </div>
      {flow.startsAt === "stale" ? (
        <p data-testid="flow-starts-at-stale" className="mt-3 flex items-center gap-2 text-xs text-fg-2">
          <span aria-hidden className="size-2 rounded-full border border-dashed border-fg-3" />
          No cleared or voided checks were imported, so the ledger total is unknown and the diagram starts at Stale.
        </p>
      ) : null}
      <div className="mt-5 rounded-[10px] border border-line bg-ink-1/60 px-3 py-4 sm:px-5">
        <FlowPlayer nodes={main.nodes} links={main.links} height={320} verticalHeight={620} drawAtMs={1000} />
        {rec.links.length > 0 ? (
          <div className="mt-4 border-t border-line pt-3" data-testid="recovery-band">
            <InstrumentLabel as="p">Recovered from state portals</InstrumentLabel>
            <FlowPlayer nodes={rec.nodes} links={rec.links} height={72} verticalHeight={150} drawAtMs={1600} mirror />
          </div>
        ) : null}
      </div>
      <SrTable
        caption={`Money flow as of ${formatDate(flow.asOf)}; open exposure ${formatUSD(exposure.totalCents)}`}
        columns={["From", "To", "Amount", "Items", "Needs you"]}
        rows={flow.links.map((l) => [label(l.source), label(l.target), formatUSD(l.cents), String(l.count), l.tone === "human" ? "Yes" : "No"])}
      />
    </section>
  );
}
