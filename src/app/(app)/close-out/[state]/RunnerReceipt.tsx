import { BadgeCheck, Download, FileText } from "lucide-react";
import { CopyButton } from "@/components/b/CopyButton";
import { Money, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { fmtIso } from "@/lib/close-out/derive";
import type { RunnerReceipt as Receipt } from "@/lib/close-out/runner-model";
import { cn } from "@/lib/utils";

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6" data-testid={testId}>
      <dt className="text-[13px] text-fg-2">{label}</dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-1 sm:justify-end sm:text-right">{children}</dd>
    </div>
  );
}

function Interest({ r }: { r: Receipt }) {
  const i = r.interest;
  if (i.status === "ok") {
    return (
      <>
        <span>
          ~<Money cents={i.cents} /> accruing, from the rule file ({i.ruleVersion})
        </span>
        {!i.verified ? <UnverifiedBadge /> : null}
      </>
    );
  }
  if (i.status === "unknown") {
    return (
      <>
        <UnknownBadge label="UNKNOWN" />
        <span className="text-[13px] text-fg-2">{i.reason}. No rate is assumed.</span>
      </>
    );
  }
  return <span className="text-fg-2">None: nothing in this filing is late.</span>;
}

/** The close-out receipt: what was filed on the replica portal, by whom, how late, and the interest disclosed. */
export function RunnerReceipt({ r, state }: { r: Receipt; state: string }) {
  return (
    <section aria-labelledby="receipt-h" className="co-rise relative overflow-hidden rounded-xl border border-blue-800 bg-blue-900/50 p-5" data-testid="runner-receipt">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
      <h2 id="receipt-h" className="flex items-center gap-2 text-[15px] font-semibold text-fg-1">
        <BadgeCheck className="co-pop size-5 text-blue-400" strokeWidth={1.75} aria-hidden /> {state} filed on the replica portal
      </h2>
      {r.confirmation ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-2">
          Confirmation
          <span className="font-mono text-lg font-semibold tracking-wide break-all text-fg-1" data-testid="receipt-confirmation">
            {r.confirmation}
          </span>
          <CopyButton value={r.confirmation} />
        </p>
      ) : (
        <p className="mt-3 text-sm text-fg-2">Submitted. The portal has not returned a confirmation number yet.</p>
      )}
      <dl className="mt-3 divide-y divide-line border-y border-line">
        <Row label="Filed" testId="receipt-filed">
          <span>
            {r.itemCount} {r.itemCount === 1 ? "item" : "items"}, <Money cents={r.totalCents} />
          </span>
        </Row>
        <Row label="To remit">
          <span>
            <Money cents={r.totalCents} /> {r.remitDue ? `due ${fmtIso(r.remitDue)}` : "due date UNKNOWN"}. Payment happens outside this app.
          </span>
          {r.remitDue && r.remitDueUnverified ? <UnverifiedBadge compact /> : null}
        </Row>
        <Row label="Report due" testId="receipt-late">
          {r.reportDue ? (
            <>
              <span>
                {fmtIso(r.reportDue)}
                {r.daysLate ? <span className="text-pink-300">, filed {r.daysLate} days late</span> : ", on time"}
              </span>
              {r.reportDueUnverified ? <UnverifiedBadge compact /> : null}
            </>
          ) : (
            <UnknownBadge label="UNKNOWN" />
          )}
        </Row>
        <Row label="Late interest disclosed" testId="receipt-interest">
          <Interest r={r} />
        </Row>
        <Row label="Approved by">
          <span>{r.approvedBy ?? "Unknown"}</span>
        </Row>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={r.evidenceHref} download data-testid="receipt-evidence" className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2 px-3 max-sm:h-10")}>
          <FileText className="size-4" strokeWidth={1.5} aria-hidden /> Evidence pack (PDF)
        </a>
        <a href={r.fileHref} download className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2 px-3 max-sm:h-10")}>
          <Download className="size-4" strokeWidth={1.5} aria-hidden /> NAUPA file
        </a>
      </div>
      <p className="mt-3 text-xs text-fg-2">Replica system only: nothing was filed with a real state. Interest is the rules engine&apos;s figure to the demo-clock date; confirm with counsel.</p>
    </section>
  );
}
