import { ArrowUpRight, BadgeCheck, Download, FileText } from "lucide-react";
import { RuleVersion } from "@/components/ui/rule-version";
import { CopyButton } from "@/components/b/CopyButton";
import { Money, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { fmtIso } from "@/lib/close-out/derive";
import type { RunnerReceipt as Receipt } from "@/lib/close-out/runner-model";
import { stageLabel } from "@/lib/reports/filing-record";
import { replicaFilingUrl } from "@/lib/replica/filing-url";
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
    // R7-12: once the remittance is recorded the late clock has stopped; the frozen figure is the one at approval.
    const when = r.remittance && r.frozen ? "at approval" : "accruing";
    return (
      <>
        <span>
          ~<Money cents={i.cents} /> {when}, from the rule file (<RuleVersion version={i.ruleVersion} />)
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

function Remittance({ r }: { r: Receipt }) {
  if (r.stageRemits === false) {
    // R6-02: a notice-only filing carries no money; the next stage comes from the rule file, never an invented date.
    const next = r.nextStage;
    const label = next ? `${stageLabel(next.name)} due ${next.due ? fmtIso(next.due.date) : "UNKNOWN"}` : "Not in the rule file";
    return (
      <Row label="Next stage" testId="receipt-next-stage">
        <span>{label}. This notice report carries no money.</span>
        {next?.due?.unverified ? <UnverifiedBadge compact /> : null}
      </Row>
    );
  }
  if (r.remittance) {
    return (
      <Row label="Remitted" testId="receipt-remitted">
        <span>
          <Money cents={r.remittance.totalCents} /> on {fmtIso(r.remittance.remittedOn)}
          {r.remittance.reference ? `, ref ${r.remittance.reference}` : ""}. Recorded by {r.remittance.by}; paid outside this app.
        </span>
      </Row>
    );
  }
  return (
    <Row label="To remit" testId="receipt-to-remit">
      <span>
        <Money cents={r.totalCents} /> {r.remitDue ? `due ${fmtIso(r.remitDue)}` : "due date UNKNOWN"}. Pay outside this app, then record it below.
      </span>
      {r.remitDue && r.remitDueUnverified ? <UnverifiedBadge compact /> : null}
    </Row>
  );
}

function Unverified({ r }: { r: Receipt }) {
  if (r.unverifiedRuleCount === 0) return <span>{r.frozen ? "All verified at approval" : "All verified"}</span>;
  const how = r.unverifiedAcknowledged ? "approved anyway" : "approved without the approve-anyway step";
  return (
    <>
      <span>
        {r.unverifiedRuleCount} still UNVERIFIED{r.frozen ? " at approval" : ""}; {how}
      </span>
      <UnverifiedBadge compact />
    </>
  );
}

function FrozenNote({ r }: { r: Receipt }) {
  const head =
    r.frozen && r.frozenAsOf
      ? `Filing record frozen at approval (demo date ${fmtIso(r.frozenAsOf)}); recording the remittance adds to it and never changes it.`
      : "Filed before filing records were kept: these figures are read from the current records.";
  return (
    <p className="mt-3 text-xs text-fg-2" data-testid="receipt-frozen-note">
      {head} Replica system only: nothing was filed with a real state. Interest is the rules engine&apos;s figure; confirm with counsel.
    </p>
  );
}

/** The confirmation number, linked to where the replica state's holder portal lists this filing (replica only). */
function ConfirmationNumber({ state, confirmation }: { state: string; confirmation: string }) {
  const href = replicaFilingUrl(state, confirmation);
  const text = (
    <span className="font-mono text-lg font-semibold tracking-wide break-all text-fg-1" data-testid="receipt-confirmation">
      {confirmation}
    </span>
  );
  if (!href) return text;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-sm underline decoration-blue-400 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
      data-testid="receipt-confirmation-link"
      title="Open this filing on the replica state portal"
    >
      {text}
      <ArrowUpRight className="size-4 shrink-0 text-blue-400" aria-hidden />
      <span className="sr-only">(view on the replica portal)</span>
    </a>
  );
}

/**
 * The close-out receipt: what was filed on the replica portal, by whom, how late, and the interest disclosed. R6-01:
 * every filing fact is printed from the frozen filing record (written at approval), so recording the remittance or
 * any later change to the items cannot rewrite it. Reports shows the same component.
 */
export function RunnerReceipt({ r, state }: { r: Receipt; state: string }) {
  const headingId = `receipt-h-${r.reportId}`;
  return (
    <section
      aria-labelledby={headingId}
      className="co-rise relative overflow-hidden rounded-xl border border-blue-800 bg-blue-900/50 p-5"
      data-testid="runner-receipt"
      data-frozen={r.frozen ? "true" : "false"}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
      <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-semibold text-fg-1">
        <BadgeCheck className="co-pop size-5 shrink-0 text-blue-400" strokeWidth={1.75} aria-hidden /> {state} {r.stage ? `${r.stage} report ` : ""}filed on the replica portal
      </h2>
      {r.confirmation ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-2">
          Confirmation
          <ConfirmationNumber state={state} confirmation={r.confirmation} />
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
        <Remittance r={r} />
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
        <Row label="Approved by" testId="receipt-approver">
          <span>{r.approvedBy ?? "Unknown"}</span>
        </Row>
        <Row label="Rule values relied on" testId="receipt-unverified">
          <Unverified r={r} />
        </Row>
        {r.warningCount !== null ? (
          <Row label="Validator" testId="receipt-validator">
            <span>No errors{r.warningCount ? `, ${r.warningCount} ${r.warningCount === 1 ? "warning" : "warnings"}` : ""}</span>
          </Row>
        ) : null}
        {r.unsentNotices.length > 0 ? (
          <Row label="Due-diligence notices" testId="receipt-unsent">
            <span className="text-pink-300">
              {r.unsentNotices.length} never sent: {r.unsentNotices.map((x) => `${x.payeeName} (${x.reason})`).join("; ")}
            </span>
          </Row>
        ) : null}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={r.evidenceHref} download data-testid="receipt-evidence" className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2 px-3 max-sm:h-10")}>
          <FileText className="size-4" strokeWidth={1.5} aria-hidden /> Evidence pack (PDF)
        </a>
        <a href={r.fileHref} download className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2 px-3 max-sm:h-10")}>
          <Download className="size-4" strokeWidth={1.5} aria-hidden /> NAUPA file
        </a>
      </div>
      <FrozenNote r={r} />
    </section>
  );
}
