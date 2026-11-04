import { CheckCircle2 } from "lucide-react";
import { Stamp } from "@/components/viz/flip-stamp/FlipStamp";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { ownerRailView, type OwnerView } from "./view";

/** The amount and what it is. Plain words, no internal codes. */
export function OwnerDetails({ v }: { v: OwnerView }) {
  return (
    <dl className="owner-dl" aria-label="Payment details">
      <dt>Payable to</dt>
      <dd>{v.payeeName}</dd>
      <dt>What it is</dt>
      <dd>
        {v.itemLabel}
        {v.referenceNumber ? ` #${v.referenceNumber}` : ""}
      </dd>
      <dt>Issued</dt>
      <dd>{formatDate(v.issueDate)}</dd>
    </dl>
  );
}

/**
 * Where this stands, for the owner (§6.17): Issued → "We wrote to you" → the deadline to respond before the money
 * goes to the state. Owner-facing only (R4-13, R5-13): plain dated steps, no compliance badges, verification columns,
 * rule codes or "Unknown" chips. A step without a date is left out; a respond-by date that rests on a rule value
 * nobody has checked yet reads "(estimated)" in plain words.
 */
export function OwnerRail({ v }: { v: OwnerView }) {
  const view = ownerRailView(v);
  return (
    <section className="owner-rail" aria-labelledby="owner-rail-h">
      <h2 id="owner-rail-h" className="owner-h2">
        Where this stands
      </h2>
      <ol className="owner-steps">
        {view.steps.map((s) => (
          <li key={s.key} className="owner-step" data-key={s.key}>
            <span className="owner-step-dot" aria-hidden />
            <span className="owner-step-label">{s.label}</span>
            <time dateTime={s.date} className="owner-step-date">
              {formatDate(s.date)}
            </time>
          </li>
        ))}
      </ol>
      <p className="owner-help">{view.help}</p>
    </section>
  );
}

export function amountLabel(cents: number): string {
  return formatUSD(cents);
}

/** After a response: a plain confirmation with the stamp (static under reduced motion). */
export function OwnerConfirmed({ title, next }: { title: string; next: string }) {
  return (
    <section className="owner-card owner-confirmed" role="status" aria-labelledby="owner-done-title">
      <Stamp land className="owner-stamp">
        <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden />
        Received
      </Stamp>
      <h1 id="owner-done-title" className="owner-h1">
        {title}
      </h1>
      <h2 className="owner-h2">What happens next</h2>
      <p className="owner-lede">{next}</p>
    </section>
  );
}
