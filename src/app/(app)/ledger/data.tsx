import { Download } from "lucide-react";
import { InstrumentLabel, Section, SyntheticChip } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { MINUS, signedDisplay } from "@/components/viz/waterfall/waterfall-model";
import { NotCoveredNote } from "@/components/coverage/NotCoveredNote";
import { isStateCovered } from "@/lib/coverage";
import { formatDate } from "@/lib/format";
import { monthLabel, monthsWithActivity } from "@/lib/close-pack/period";
import type { Movement } from "@/lib/ledger/movements";
import type { Roll } from "@/lib/ledger/rollforward";
import { formatUSD } from "@/lib/money";
import { computeLedger, ledgerMovements, loadLedger, type LedgerView as View } from "@/lib/queries/ledger";
import { getCtx } from "@/lib/ui/ctx";
import { cn } from "@/lib/utils";
import { BalancedBadge, JournalTable } from "./JournalTable";
import { closePreviews, listClosedPeriods } from "@/lib/close-pack/close";
import { ClosePackButton } from "./ClosePackButton";
import { LedgerView, PeriodChips, type BarItem, type BarKey } from "./LedgerView";
import { loadLedgerParams } from "./params";

export const RECOGNITION_POLICY = "Recognized when stale (180-day business threshold, not law).";

const toItem = (m: Movement): BarItem => ({ id: m.itemId, payee: m.payee, check: m.checkNumber, cents: m.amountCents, date: m.date, state: m.state, type: m.propertyType });

interface Line {
  key: keyof Pick<Roll, "opening" | "identified" | "resolved" | "clearedLate" | "remitted" | "closing">;
  label: string;
  sign: "total" | "up" | "down";
}

/** "Cleared late by bank" is always a line (even at $0.00): the identity names every flow rollforward.ts computes. */
function lines(): Line[] {
  return [
    { key: "opening", label: "Opening balance", sign: "total" },
    { key: "identified", label: "Identified (went stale)", sign: "up" },
    { key: "resolved", label: "Resolved with owner", sign: "down" },
    { key: "clearedLate", label: "Cleared late by bank", sign: "down" },
    { key: "remitted", label: "Remitted to the state", sign: "down" },
    { key: "closing", label: "Closing balance", sign: "total" },
  ];
}

/** The identity in words and figures, under the headline. */
function Identity({ r }: { r: Roll }) {
  const parts: [string, string][] = [
    ["opening", formatUSD(r.opening)],
    ["identified", `+ ${formatUSD(r.identified)}`],
    ["resolved", `${MINUS} ${formatUSD(r.resolved)}`],
    ["cleared late", `${MINUS} ${formatUSD(r.clearedLate)}`],
    ["remitted", `${MINUS} ${formatUSD(r.remitted)}`],
  ];
  return (
    <p data-testid="ledger-identity" className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs text-fg-2">
      {parts.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap">
          <span className="text-fg-1">{v}</span> <span className="text-fg-3">{k}</span>
        </span>
      ))}
      <span className="whitespace-nowrap">
        = <span className="text-fg-1">{formatUSD(r.closing)}</span> <span className="text-fg-3">closing</span>
      </span>
    </p>
  );
}

/** At phone width the table scrolls sideways; the Total column stays pinned to the right edge so it is never off screen. */
const PIN_TOTAL = "sticky right-0 border-l border-line bg-ink-2 font-medium";
const PIN_TOTAL_HEAD = `${PIN_TOTAL} text-fg-1`;

function RollTable({ view }: { view: View }) {
  const cols = [...view.roll.states, view.roll.total];
  return (
    <>
    <p data-testid="roll-scroll-cue" className="mb-2 text-xs text-fg-3 sm:hidden">
      Scroll sideways for every state. The Total column stays pinned.
    </p>
    <div className="es-scroll-x glass rounded-[18px]" tabIndex={0} role="region" aria-label="Roll-forward by owner state">
      <table className="w-full min-w-[560px] border-collapse" data-testid="rollforward-table">
        <caption className="sr-only">
          Liability roll-forward by owner state, {view.roll.period.label}, {formatDate(view.roll.period.start)} to {formatDate(view.roll.period.end)}
        </caption>
        <thead>
          <tr className="border-b border-line text-[11px] tracking-[0.06em] text-fg-3 uppercase">
            <th scope="col" className="py-2.5 pr-3 pl-4 text-left font-medium">
              Line
            </th>
            {cols.map((c) => (
              <th key={c.state} scope="col" className={cn("py-2.5 pr-4 text-right font-medium", c === view.roll.total && PIN_TOTAL_HEAD)}>
                {c.state}
                {c !== view.roll.total && !isStateCovered(c.state, view.ruleStates) ? (
                  <span data-testid={`roll-not-covered-${c.state}`} className="block text-[10px] font-normal tracking-normal text-fg-3 normal-case">
                    rules not loaded
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines().map((l) => (
            <tr key={l.key} data-testid={`roll-${l.key}`} className={cn("border-b border-line", l.sign === "total" && "bg-ink-1/50")}>
              <th scope="row" className={cn("py-2 pr-3 pl-4 text-left text-[13px] font-normal whitespace-nowrap", l.sign === "total" ? "text-fg-1" : "text-fg-2")}>
                {l.sign === "up" ? "+ " : l.sign === "down" ? `${MINUS} ` : l.key === "closing" ? "= " : ""}
                {l.label}
              </th>
              {cols.map((c) => {
                const v = c[l.key];
                return (
                  <td
                    key={c.state}
                    data-state={c.state}
                    className={cn(
                      "num py-2 pr-4 text-right text-[13px] whitespace-nowrap",
                      v === 0 && l.sign !== "total" ? "text-fg-3" : l.sign === "total" ? "font-medium text-fg-1" : "text-fg-1",
                      c === view.roll.total && PIN_TOTAL,
                    )}
                  >
                    {l.sign === "total" ? formatUSD(v) : signedDisplay(l.sign, v)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr data-testid="roll-check">
            <th scope="row" className="py-2 pr-3 pl-4 text-left text-xs font-normal text-fg-3">
              Ties to item balances
            </th>
            {cols.map((c) => (
              <td key={c.state} className={cn("py-2 pr-4 text-right text-xs", c === view.roll.total && PIN_TOTAL)}>
                <span className={c.reconciles ? "text-blue-300" : "text-pink-300"}>{c.reconciles ? "Ties" : "Does not tie"}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
    </>
  );
}

export async function LedgerData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = loadLedgerParams(await searchParams);
  const { db, companyId } = await getCtx();
  const data = await loadLedger(db, companyId);
  const view = computeLedger(data, p.period);
  const fyLabel = computeLedger(data, "fy").roll.period.label;
  const { roll, journal } = view;
  const { period, total } = roll;
  const showClearedLate = roll.anyClearedLate;
  const behind = Object.fromEntries(Object.entries(view.behind).map(([k, ms]) => [k, ms.map(toItem)])) as Record<BarKey, BarItem[]>;
  const monthIds = monthsWithActivity(ledgerMovements(data), data.today);
  const months = monthIds.map((id) => ({ id, label: monthLabel(id) }));
  const closePreview = closePreviews(data, monthIds);
  const closedMonths = Object.fromEntries((await listClosedPeriods(db, companyId)).map((c) => [c.period, c]));
  const allTie = total.reconciles && roll.states.every((s) => s.reconciles);

  return (
    <div className="space-y-12" data-testid="ledger" data-period={period.id} data-today={view.today}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodChips fyLabel={fyLabel} />
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/ledger.csv?period=${period.id}`}
            download
            data-testid="ledger-export"
            className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")}
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
            Export JE CSV
          </a>
          <ClosePackButton months={months} previews={closePreview} closed={closedMonths} />
        </div>
      </div>

      <section aria-label="Liability roll-forward" className="-mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <div className="flex flex-wrap items-center gap-2">
            <InstrumentLabel>Closing liability · {period.label}</InstrumentLabel>
            <SyntheticChip />
          </div>
          <p
            data-testid="ledger-closing"
            data-cents={total.closing}
            data-reconciles={allTie ? "true" : "false"}
            className="num mt-3 text-[clamp(2.5rem,1.6rem+3vw,4rem)] leading-none font-medium tracking-[-0.045em] text-fg-1"
          >
            {formatUSD(total.closing)}
          </p>
          <p className="mt-3 text-sm text-fg-2">
            Unclaimed property payable, {formatDate(period.start)} to <time dateTime={period.end}>{formatDate(period.end)}</time> (demo clock).
          </p>
          <Identity r={total} />
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <BalancedBadge balanced={journal.balanced && allTie} />
            <span className="text-xs text-fg-3">
              Debits equal credits in every entry and every state; the closing ties to the open items.
            </span>
          </div>
          <NotCoveredNote
            summary={view.notCovered}
            testId="ledger-not-covered"
            className="mt-6"
            extra="Their payable stays in this closing balance and ties to the item balances."
          />
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4">
            <div>
              <dt className="text-xs text-fg-3">Identified</dt>
              <dd data-testid="ledger-identified" className="num mt-0.5 text-[15px] font-medium text-fg-1">
                {formatUSD(total.identified)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-3">Remitted</dt>
              <dd className="num mt-0.5 text-[15px] font-medium text-fg-1">{formatUSD(total.remitted)}</dd>
            </div>
          </dl>
          <p data-testid="recognition-policy" className="mt-6 border-l-2 border-blue-500/60 pl-3 text-[13px] text-fg-2">
            {RECOGNITION_POLICY} An item leaves the liability on the demo date it was resolved with the owner, cleared at the bank, or remitted.
          </p>
        </div>
        <div className="min-w-0 glass rounded-[18px] p-4 sm:p-6 lg:col-span-7">
          <LedgerView
            total={total}
            states={roll.states}
            behind={behind}
            showClearedLate={showClearedLate}
            periodLabel={`${period.label}, ${formatDate(period.start)} to ${formatDate(period.end)}`}
            periodKey={`${period.id}-${period.end}`}
          />
        </div>
      </section>

      <Section title="Roll-forward by owner state" meta={`${period.label} · integer cents, identity checked per state`} id="ledger-roll">
        <RollTable view={view} />
      </Section>

      <Section
        title="Journal entries"
        meta={`${journal.entries.length} ${journal.entries.length === 1 ? "entry" : "entries"} · per state, property type and month`}
        id="ledger-journal"
        action={<BalancedBadge balanced={journal.balanced} testId="journal-balanced" />}
      >
        <JournalTable journal={journal} ruleStates={view.ruleStates} />
      </Section>
    </div>
  );
}
