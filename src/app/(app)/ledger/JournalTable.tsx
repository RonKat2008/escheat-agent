import { CircleAlert, CircleCheck } from "lucide-react";
import { UnverifiedBadge } from "@/components/primitives";
import { isStateCovered } from "@/lib/coverage";
import { formatDate } from "@/lib/format";
import { CHART_LABEL } from "@/lib/ledger/accounts";
import type { Journal, JournalEntry, StateBalance } from "@/lib/ledger/journal";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Blue check when debits equal credits; pink (a person must look) when they do not. */
export function BalancedBadge({ balanced, testId = "balanced-badge", className }: { balanced: boolean; testId?: string; className?: string }) {
  return (
    <span
      data-testid={testId}
      data-balanced={balanced ? "true" : "false"}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        balanced ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-pink-500/50 bg-pink-500/10 text-pink-300",
        className,
      )}
    >
      {balanced ? <CircleCheck className="size-3.5" strokeWidth={2} aria-hidden /> : <CircleAlert className="size-3.5" strokeWidth={2} aria-hidden />}
      {balanced ? "Balanced" : "Out of balance"}
    </span>
  );
}

const amount = (c: number) => (c === 0 ? "" : formatAmount(c));

function EntryRows({ e }: { e: JournalEntry }) {
  return (
    <>
      {e.lines.map((l, i) => (
        <tr key={i} data-testid={i === 0 ? "je-row" : undefined} data-je={e.je} className={cn("align-baseline", i === e.lines.length - 1 && "border-b border-line")}>
          {i === 0 ? (
            <th scope="row" rowSpan={e.lines.length} className="py-2 pr-3 pl-4 text-left align-top font-normal whitespace-nowrap">
              <span className="num block text-[13px] text-fg-1">{e.je}</span>
              <span className="block text-xs text-fg-3">{formatDate(e.date)}</span>
            </th>
          ) : null}
          <td className={cn("min-w-[11rem] py-1.5 pr-3 text-[13px] sm:whitespace-nowrap", l.creditCents > 0 ? "pl-6 text-fg-2" : "text-fg-1")}>
            <span className="num text-fg-3">{l.account.code}</span> {l.account.name}
          </td>
          <td className="num py-1.5 pr-3 text-right text-[13px] whitespace-nowrap text-fg-1">{amount(l.debitCents)}</td>
          <td className="num py-1.5 pr-4 text-right text-[13px] whitespace-nowrap text-fg-1">{amount(l.creditCents)}</td>
          {i === 0 ? (
            <td rowSpan={e.lines.length} className="max-w-[340px] py-2 pr-4 align-top text-xs text-fg-2">
              <span className="block text-pretty">{e.memo}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-fg-3">
                <span className="num break-all">{e.ref}</span>
                {e.unverified ? <UnverifiedBadge className="border-pink-500/60 text-pink-300" /> : null}
              </span>
            </td>
          ) : null}
        </tr>
      ))}
    </>
  );
}

function StateBlock({ s, entries, covered }: { s: StateBalance; entries: JournalEntry[]; covered: boolean }) {
  return (
    <section aria-labelledby={`je-${s.state}-h`} data-testid="je-state" data-state={s.state} className="glass rounded-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-3">
        <h3 id={`je-${s.state}-h`} className="flex items-baseline gap-2 text-sm font-medium text-fg-1">
          {s.state}
          {covered ? null : (
            <span data-testid="je-not-covered" className="rounded-[2px] border border-dashed border-fg-3 px-1 font-mono text-[9px] font-normal tracking-[0.06em] text-fg-2">
              RULES NOT LOADED
            </span>
          )}
          <span className="text-xs font-normal text-fg-3">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
          <span>
            Dr <span className="num text-fg-1">{formatAmount(s.debitCents)}</span>
          </span>
          <span>
            Cr <span className="num text-fg-1">{formatAmount(s.creditCents)}</span>
          </span>
          <BalancedBadge balanced={s.balanced} testId="je-state-balanced" />
        </div>
      </header>
      <div className="es-scroll-x border-t border-line" tabIndex={0} role="region" aria-label={`${s.state} journal entries`}>
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-[11px] tracking-[0.06em] text-fg-3 uppercase">
              <th scope="col" className="py-2 pr-3 pl-4 font-medium">
                Entry
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Account
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Credit
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Memo · Ref
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <EntryRows key={e.je} e={e} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The period's journal, one block per owner state, with the per-state debit = credit check. */
export function JournalTable({ journal, ruleStates }: { journal: Journal; ruleStates: readonly string[] }) {
  if (journal.entries.length === 0) {
    return <p className="text-[13px] text-fg-2">No liability movements in this period, so there is nothing to journal.</p>;
  }
  return (
    <div className="space-y-4" data-testid="journal">
      <p className="text-xs text-fg-3">
        {CHART_LABEL}. Account codes are an example; the CSV is a file to import, nothing is posted.
      </p>
      {journal.byState.map((s) => (
        <StateBlock key={s.state} s={s} covered={isStateCovered(s.state, ruleStates)} entries={journal.entries.filter((e) => e.state === s.state)} />
      ))}
    </div>
  );
}
