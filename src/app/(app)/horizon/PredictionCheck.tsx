import Link from "next/link";
import type { CSSProperties } from "react";
import { InView } from "@/components/motion";
import { formatDate } from "@/lib/format";
import type { LinkedReconciliation, LinkedRow } from "@/lib/horizon/check";
import type { HorizonCheckEntry } from "@/lib/horizon/check-read";
import { formatUSD } from "@/lib/money";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { OpenClockButton } from "./OpenClockButton";

/** Matched pairs shown before "and N more" (every difference is always shown). */
const MATCHED_SHOWN = 12;

const payments = (n: number) => plural(n, "payment");

/** "On Nov 1 Horizon predicted 4 payments ($3,438.94) would go stale by Dec 1. 4 were detected ($3,438.94)." */
export function checkSentence(c: LinkedReconciliation): string {
  const were = c.detected.count === 1 ? "was" : "were";
  return `On ${formatDate(c.asOf)} Horizon predicted ${payments(c.predicted.count)} (${formatUSD(c.predicted.cents)}) would go stale by ${formatDate(c.by)}. ${c.detected.count} ${were} detected (${formatUSD(c.detected.cents)}).`;
}

function statusText(c: LinkedReconciliation): string {
  if (c.status === "all") return c.predicted.count === 0 ? "Nothing predicted, nothing detected" : `All ${c.predicted.count} detected`;
  const n = c.missed.length + c.unexpected.length;
  return plural(n, "difference");
}

function Cell({ row, side, testId }: { row: LinkedRow | null; side: "left" | "right"; testId?: string }) {
  if (!row) {
    return (
      <span className={cn("self-center text-xs text-fg-3", side === "right" ? "text-left" : "text-right")}>
        {side === "right" ? "Not detected" : "Not predicted"}
      </span>
    );
  }
  const body = (
    <>
      <span className="block truncate text-[13px] text-fg-1">{row.payee}</span>
      <span className="flex items-baseline gap-2 text-xs text-fg-3">
        <span className="num text-fg-2">{formatUSD(row.cents)}</span>
        {row.check ? <span className="truncate font-mono">#{row.check}</span> : null}
        {row.state ? <span>{row.state}</span> : null}
      </span>
    </>
  );
  const box = "block min-w-0 rounded-md border border-line bg-ink-1 px-2.5 py-1.5";
  if (!row.href) return <span className={box}>{body}</span>;
  return (
    <Link
      href={row.href}
      data-testid={testId}
      className={cn(box, "transition-colors duration-150 hover:border-blue-700 hover:bg-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400")}
    >
      {body}
    </Link>
  );
}

/** The thin line between the two columns: solid blue for a match, a short dashed stub for a one-sided row. */
function Connector({ kind, i }: { kind: "match" | "left" | "right"; i: number }) {
  const style = { "--i": i } as CSSProperties;
  if (kind === "match") {
    return (
      <span aria-hidden className="relative self-center">
        <span className="es-iv-grow-x block h-px origin-left bg-blue-500" style={style} />
        <span className="es-iv-fade absolute top-1/2 left-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400" style={style} />
        <span className="es-iv-fade absolute top-1/2 right-0 size-1.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400" style={style} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("flex self-center", kind === "left" ? "justify-start" : "justify-end")}>
      <span className="es-iv-fade block w-1/2 border-t border-dashed border-fg-4" style={style} />
    </span>
  );
}

function Row({ left, right, kind, note, i, testId }: { left: LinkedRow | null; right: LinkedRow | null; kind: "match" | "left" | "right"; note: string | null; i: number; testId: string }) {
  const label = left ?? right;
  return (
    <li data-testid={testId} data-ledger-id={label?.id} className="grid grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] gap-y-1 sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]">
      <Cell row={left} side="left" testId={left ? "check-link-predicted" : undefined} />
      <Connector kind={kind} i={i} />
      <Cell row={right} side="right" testId={right ? "check-link-detected" : undefined} />
      {note ? <p className="col-span-3 text-xs text-fg-3" data-testid="check-note">{note}</p> : null}
    </li>
  );
}

function Pairs({ c }: { c: LinkedReconciliation }) {
  const shown = c.matched.slice(0, MATCHED_SHOWN);
  const more = c.matched.length - shown.length;
  return (
    <InView threshold={0.05}>
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] text-label uppercase text-fg-3 sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]" aria-hidden>
        <span>Predicted on {formatDate(c.asOf)}</span>
        <span />
        <span>Detected by {formatDate(c.by)}</span>
      </div>
      <ul className="space-y-2" aria-label={`Predicted and detected payments, ${formatDate(c.asOf)} to ${formatDate(c.by)}`}>
        {c.missed.map((r, i) => (
          <Row key={`m-${r.id}`} left={r} right={null} kind="left" note={r.note} i={i} testId="check-row-missed" />
        ))}
        {c.unexpected.map((r, i) => (
          <Row key={`u-${r.id}`} left={null} right={r} kind="right" note={r.note} i={c.missed.length + i} testId="check-row-unexpected" />
        ))}
        {shown.map((r, i) => (
          <Row key={`p-${r.id}`} left={r} right={r} kind="match" note={r.note} i={c.missed.length + c.unexpected.length + i} testId="check-row-matched" />
        ))}
      </ul>
      {more > 0 ? <p className="mt-2 text-xs text-fg-3">and {more} more matched {more === 1 ? "payment" : "payments"}, each detected as predicted.</p> : null}
    </InView>
  );
}

function Latest({ entry }: { entry: HorizonCheckEntry }) {
  const c = entry.check;
  if (!c) {
    return (
      <p className="text-[13px] text-fg-2" data-testid="check-not-recorded">
        The latest forward move ({formatDate(entry.prevDay)} to {formatDate(entry.day)}) predates the prediction check, so no forecast was stored for it
        and none is reconstructed.
        {entry.detectedCount !== null ? ` It detected ${payments(entry.detectedCount)} (${formatUSD(entry.detectedCents ?? 0)}).` : ""} Move the clock
        forward again to check Horizon.
      </p>
    );
  }
  return (
    <div
      className="space-y-4"
      data-testid="check-latest"
      data-status={c.status}
      data-predicted-count={c.predicted.count}
      data-predicted-cents={c.predicted.cents}
      data-detected-count={c.detected.count}
      data-detected-cents={c.detected.cents}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-md text-fg-1 text-pretty" data-testid="check-sentence">
          {checkSentence(c)}
        </p>
        <p
          data-testid="check-status"
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5 text-[13px] font-medium",
            c.status === "all" ? "border-blue-600 bg-blue-950 text-blue-200" : "border-line-strong bg-ink-3 text-fg-1",
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", c.status === "all" ? "bg-blue-400" : "bg-fg-2")} />
          {statusText(c)}
        </p>
      </div>
      {c.predicted.count + c.detected.count > 0 ? <Pairs c={c} /> : null}
    </div>
  );
}

function History({ entries }: { entries: HorizonCheckEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="group border-t border-line pt-3" data-testid="check-history">
      <summary className="cursor-pointer text-[13px] text-fg-2 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400">
        Earlier forward moves ({entries.length})
      </summary>
      <ol className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={e.eventId} className="text-[13px] text-fg-2" data-testid="check-history-row">
            <span className="num text-fg-1">
              {formatDate(e.prevDay)} → {formatDate(e.day)}
            </span>
            {": "}
            {e.check
              ? `predicted ${payments(e.check.predicted.count)} (${formatUSD(e.check.predicted.cents)}), detected ${e.check.detected.count} (${formatUSD(e.check.detected.cents)}). ${statusText(e.check)}.`
              : "no forecast stored (this move predates the check)."}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * "Horizon said so": the latest forward clock move's stored forecast next to what it detected. Read-only; the numbers
 * come from demo_clock_events.horizon_check (written in moveDemoClock's transaction), never from a model.
 */
export function PredictionCheck({ entries }: { entries: HorizonCheckEntry[] }) {
  const [latest, ...earlier] = entries;
  return (
    <section
      aria-labelledby="prediction-check-heading"
      data-testid="prediction-check"
      data-entries={entries.length}
      className="mb-8 space-y-4 rounded-[14px] border border-line bg-[linear-gradient(180deg,var(--color-ink-2),var(--color-ink-1))] p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="prediction-check-heading" className="text-label uppercase text-blue-300">
          Prediction check
        </h2>
        <p className="text-xs text-fg-3">Forecast stored at the move; compared, not recomputed</p>
      </div>
      {latest ? (
        <Latest entry={latest} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="check-empty">
          <p className="text-[13px] text-fg-2">Move the demo clock forward to check Horizon&apos;s prediction.</p>
          <OpenClockButton />
        </div>
      )}
      <History entries={earlier} />
    </section>
  );
}
