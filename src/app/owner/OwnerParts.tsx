import { CheckCircle2 } from "lucide-react";
import { LifecycleRail } from "@/components/viz/core/LifecycleRail";
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
 * Owner variant of the lifecycle rail (§6.17): Issued → "We wrote to you" → the deadline to respond before the money
 * goes to the state. Owner-facing only (R4-13): no compliance badges or rule codes. A respond-by date that rests on a
 * rule value nobody has checked yet reads "(estimated)" in plain words; an unknown one is shown as Unknown, never guessed.
 */
export function OwnerRail({ v }: { v: OwnerView }) {
  const view = ownerRailView(v);
  return (
    <div className="owner-rail">
      <LifecycleRail
        variant="owner"
        title="Where this stands"
        issueDate={v.issueDate}
        asOf={v.asOf}
        events={[
          { key: "contacted", label: "We wrote to you", date: view.wroteOn, status: view.wroteOn ? "ok" : "unknown", verified: true },
          { key: "respond_by", label: view.respondLabel, date: v.respondBy, status: v.respondBy ? "ok" : "unknown", verified: true },
        ]}
      />
      <p className="owner-help">{view.help}</p>
    </div>
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
