import { readFile } from "node:fs/promises";
import { RuleVersion } from "@/components/ui/rule-version";
import path from "node:path";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { CheckCircle2, Download, FileText, Info, ListChecks, Play, TriangleAlert } from "lucide-react";
import { closeOutPrompt } from "@/components/chat/followups";
import { CopyButton } from "@/components/b/CopyButton";
import { EmptyState, AnimatedNumber, Money, StatusPill, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { agentRuns, type Report } from "@/db/schema";
import { formatDate, plural } from "@/lib/format";
import { lateLabel, OBLIGATION_LABEL } from "@/lib/overdue";
import { getOverdue, type OverdueItem } from "@/lib/queries";
import { portalEvidence } from "@/lib/reports/portal-evidence";
import { reconcileReport } from "@/lib/reports/reconcile";
import { parseNaupaReport, type ParsedReport } from "@/lib/reports/parse";
import { listReportSummaries, type StateReportSummary } from "@/lib/reports/service";
import type { ValidationError } from "@/lib/reports/validate";
import { summarizeValidation } from "@/lib/reports/validation-summary";
import { summarizeLateMoney, type StateLateMoney } from "@/lib/reports/late-money";
import { formatUSD } from "@/lib/money";
import { tryLoadRules } from "@/lib/rules/load";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import { filingMedia } from "./filing-media";
import { filingStages, pickState } from "./filing-model";
import { FilingMediaPanel } from "./FilingMediaPanel";
import { FilingPanel } from "./FilingPanel";
import { FilingStepper } from "./FilingStepper";
import { PortalEvidencePanel } from "./PortalEvidencePanel";
import { ApproveReportButton, GenerateButton } from "./ReportActions";
import { RecordRemittance } from "../close-out/RecordRemittance";
import { remittanceOwed } from "@/lib/close-out/remittance";
import { approvalAcknowledgements } from "@/lib/close-out/approve-report";
import { buildRunner } from "@/lib/close-out/runner";
import { RunnerReceipt } from "../close-out/[state]/RunnerReceipt";
import { Validation } from "./ValidationLists";

const VALID_STATES = ["CA", "DE", "TX"];

async function parsedFile(report: Report): Promise<ParsedReport | null> {
  if (!report.filePath) return null;
  try {
    const p = path.isAbsolute(report.filePath) ? report.filePath : path.join(process.cwd(), report.filePath);
    return parseNaupaReport(await readFile(p, "latin1"));
  } catch {
    return null;
  }
}

/** Segmented state tabs with live counts. Links, so the selection lives in the URL. */
function StateTabs({ summaries, active, overdue }: { summaries: StateReportSummary[]; active: string; overdue: Record<string, number> }) {
  return (
    <nav aria-label="States" className="mb-8 grid grid-cols-3 gap-0.5 rounded-lg border border-line bg-ink-1 p-0.5 sm:inline-grid sm:grid-cols-[repeat(3,minmax(8.5rem,auto))]">
      {summaries.map((x) => {
        const on = x.state === active;
        return (
          <Link
            key={x.state}
            href={`/reports?state=${x.state}`}
            scroll={false}
            aria-current={on ? "true" : undefined}
            className={cn(
              "flex min-h-10 flex-col justify-center gap-0 rounded-md px-3.5 py-1.5 transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400 sm:flex-row sm:items-baseline sm:justify-start sm:gap-2.5",
              on ? "bg-ink-3 text-fg-1" : "text-fg-2 hover:bg-ink-2 hover:text-fg-1",
            )}
          >
            <span className="text-sm font-medium">{x.state}</span>
            <span className={cn("num text-[13px]", x.toReportCount > 0 ? (on ? "text-fg-1" : "text-fg-2") : "text-fg-3")}>
              {x.toReportCount} to report
            </span>
            {overdue[x.state] ? (
              <span className="num text-[13px] font-medium text-pink-400" data-testid={`reports-tab-overdue-${x.state}`}>
                {overdue[x.state]} overdue
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

const METRIC_CELL = [
  "pr-4",
  "pr-4 pl-5 max-md:border-l max-md:border-line md:border-l md:border-line md:pl-6",
  "pr-4 max-md:border-t max-md:border-line md:border-l md:border-line md:pl-6",
  "pr-4 pl-5 max-md:border-t max-md:border-l max-md:border-line md:border-l md:border-line md:pl-6",
];

function Metric({ label, children, index }: { label: string; children: React.ReactNode; index: number }) {
  return (
    <div className={cn("min-w-0 py-4", METRIC_CELL[index])}>
      <dt className="mb-1.5 text-[13px] text-fg-2">{label}</dt>
      <dd className="num flex h-6 items-center text-xl leading-none font-medium tracking-[-0.015em] text-fg-1">{children}</dd>
    </div>
  );
}

function Reconciliation({ s, report, parsed }: { s: StateReportSummary; report: Report; parsed: ParsedReport | null }) {
  const recon = reconcileReport({
    status: report.status,
    pool: { count: s.toReportCount, cents: s.toReportCents },
    report: { count: report.itemCount, cents: report.totalCents },
    file: parsed ? { count: parsed.properties.length, cents: parsed.summary?.amountReportedCents ?? null } : null,
  });
  const rows = recon.rows;
  const matches = recon.matches;
  return (
    <section aria-labelledby="recon-h" className="min-w-0 border-t border-line pt-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="recon-h" className="text-sm font-medium text-fg-1">
          Totals reconciliation
        </h3>
        <span className={cn("inline-flex items-center gap-1.5 text-[13px]", matches ? "text-blue-400" : "text-pink-400")}>
          {matches ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
          {matches
            ? recon.locked
              ? "Report row and filed file agree"
              : "All three agree"
            : recon.locked
              ? "The filed file does not match the report row"
              : "Items changed since this report was generated. Regenerate."}
        </span>
      </div>
      {recon.locked ? <p className="mb-3 text-xs text-fg-3">This report is submitted and locked. It is compared with its own snapshot, not with items still to report.</p> : null}
      <dl className="divide-y divide-line border-y border-line text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col items-start gap-y-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-x-4">
            <dt className="text-fg-2">{r.label}</dt>
            <dd className="flex items-baseline gap-4 whitespace-nowrap">
              {r.count !== null ? (
                <span className="num text-xs text-fg-3">
                  {r.count} {r.note ?? "item"}{r.count === 1 ? "" : "s"}
                </span>
              ) : null}
              {r.cents !== null ? <Money cents={r.cents} /> : <span className="text-fg-3 italic">Unknown</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Report and remittance deadlines already missed in this state, from the shared overdue assessment (src/lib/overdue.ts).
 * Pink: a human has to file late. Grouped by the missed date so it reads "Due Jul 1, 2026, 123 days late".
 */
function OverdueReportNote({ state, items }: { state: string; items: OverdueItem[] }) {
  const late = items.flatMap((i) => i.overdue.filter((o) => o.kind !== "dd_window_end").map((o) => ({ i, o })));
  if (late.length === 0) return null;
  const groups = new Map<string, { kind: string; date: string; daysLate: number; ids: Set<string>; cents: number; verified: boolean }>();
  for (const { i, o } of late) {
    const key = `${o.date}|${o.kind}`;
    const g = groups.get(key) ?? { kind: o.kind, date: o.date, daysLate: o.daysLate, ids: new Set<string>(), cents: 0, verified: true };
    if (!g.ids.has(i.itemId)) g.cents += i.amount.cents;
    g.ids.add(i.itemId);
    groups.set(key, { ...g, verified: g.verified && o.verified });
  }
  return (
    <section
      aria-labelledby="report-overdue-h"
      data-testid="report-overdue"
      className="relative overflow-hidden rounded-xl border border-pink-500/50 bg-pink-900/40 px-5 py-4 sm:pl-6"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-pink-500" />
      <h3 id="report-overdue-h" className="flex items-center gap-2 text-[13px] font-medium text-pink-300">
        <TriangleAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {/* R5-05: once the report is filed, only the payment can still be late. */}
        {state} {late.every(({ o }) => o.kind === "remit_due") ? "remittance" : "filing"} is overdue
      </h3>
      <ul className="mt-2 space-y-1 text-sm text-fg-1">
        {[...groups.values()].map((g) => (
          <li key={`${g.date}-${g.kind}`} className="flex flex-wrap items-center gap-x-2">
            <span>
              {OBLIGATION_LABEL[g.kind as keyof typeof OBLIGATION_LABEL]} {formatDate(g.date)},{" "}
              <span className="font-medium text-pink-300">{lateLabel(g.daysLate)}</span>
            </span>
            <span className="text-fg-2">
              ({plural(g.ids.size, "item")}, <Money cents={g.cents} />)
            </span>
            {!g.verified ? <UnverifiedBadge compact /> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-fg-2">
        Dates come from the {state} rule file. Late filings can carry interest and penalties; file as soon as you can and confirm with counsel.
      </p>
    </section>
  );
}

async function latestRun(db: Awaited<ReturnType<typeof getCtx>>["db"], reportId: string): Promise<{ id: string; trace: unknown; output: unknown } | null> {
  const [row] = await db
    .select({ id: agentRuns.id, trace: agentRuns.trace, output: agentRuns.output })
    .from(agentRuns)
    .where(and(eq(agentRuns.agent, "filing_agent"), sql`${agentRuns.input}->>'reportId' = ${reportId}`))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  return row ?? null;
}

const errorsOf = (r: Report | null): ValidationError[] => ((r?.validationErrors ?? []) as ValidationError[]).filter(Boolean);

/** What the catch-up filing still needs, by report status. Nothing is filed until a person approves. */
function catchUpNext(status: string | null, generating: boolean): string {
  if (!status) return generating ? "Generating the report now. Nothing is filed." : "Generate the report to start. Nothing is filed.";
  if (status === "draft") return "The report has validation errors. Fix them and regenerate; it cannot be approved yet.";
  if (status === "validated" || status === "awaiting_approval") return "Next: you approve this exact file below. Nothing is filed until you do.";
  if (status === "approved") return "Approved. Run the filing agent below to submit it to the replica portal.";
  return "This report has been submitted to the replica portal.";
}

/**
 * Catch-up mode (the dashboard's "Generate & file catch-up report", dogfood R3 #2): late items and the interest they
 * are accruing, from the same deterministic helper as the dashboard. Pink: a person has to approve the late filing.
 */
function CatchUpBanner({ late, status, generating }: { late: StateLateMoney; status: string | null; generating: boolean }) {
  const missing = late.filingLateCount - late.inReportCount;
  return (
    <section
      aria-labelledby="catch-up-h"
      data-testid="catch-up-banner"
      className="relative overflow-hidden rounded-xl border border-pink-700 bg-pink-900/45 px-5 py-4 sm:pl-6"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-pink-500" />
      <h3 id="catch-up-h" className="text-[15px] font-medium text-fg-1">
        Catch-up filing: {plural(late.filingLateCount, "late item")}, <span className="num">{formatUSD(late.filingLateCents)}</span>
      </h3>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-2">
        {late.interest.status === "ok" ? (
          <>
            <span>
              ~<span className="num text-fg-1" data-testid="catch-up-interest">{formatUSD(late.interest.cents)}</span> audit interest accruing, from the{" "}
              {late.state} rule file (<RuleVersion version={late.interest.ruleVersion} state={late.state} />).
            </span>
            {!late.interest.verified ? <UnverifiedBadge /> : null}
          </>
        ) : late.interest.status === "unknown" ? (
          <span data-testid="catch-up-interest-gap">Interest: unknown. {late.interest.reason}; no rate is assumed.</span>
        ) : null}
      </p>
      {missing > 0 ? (
        <p className="mt-1.5 text-[13px] text-fg-2">
          {plural(missing, "late item")} {missing === 1 ? "is" : "are"} not in To Report yet, so {missing === 1 ? "it is" : "they are"} not in this file.
        </p>
      ) : null}
      <p className="mt-2 text-[13px] font-medium text-pink-300" data-testid="catch-up-next">
        {catchUpNext(status, generating)}
      </p>
    </section>
  );
}

export async function ReportsView({ searchParams }: { searchParams: Promise<{ state?: string; filter?: string; catchup?: string }> }) {
  const { state: requested, filter, catchup } = await searchParams;
  const { db, companyId } = await getCtx();
  const [summaries, overdue] = await Promise.all([listReportSummaries(db, companyId), getOverdue(db, companyId)]);
  const valid = summaries.filter((x) => VALID_STATES.includes(x.state));
  const overdueByState = Object.fromEntries(
    overdue.byState.map((b) => [b.state, overdue.items.filter((i) => i.state === b.state && i.overdue.some((o) => o.kind !== "dd_window_end")).length]),
  );
  const picked = pickState(
    (valid.length > 0 ? valid : summaries).map((x) => ({
      state: x.state,
      hasReport: Boolean(x.latest),
      toReportCount: x.toReportCount,
      status: x.latest?.status ?? null,
      overdueCount: overdueByState[x.state] ?? 0,
    })),
    requested,
    filter,
  );
  const s = summaries.find((x) => x.state === picked.state) ?? summaries[0]!;
  const report = s.latest;
  const parsed = report ? await parsedFile(report) : null;
  const run = report ? await latestRun(db, report.id) : null;
  const runId = run?.id ?? null;
  const errors = errorsOf(report);
  // R3-11: the one shared counter, so Reports and the chat tool show the same numbers.
  const { errorCount } = summarizeValidation(errors);
  const stages = filingStages(report, errorCount, s.toReportCount);
  // The single human gate: "Approve submission" is offered once the agent has filled the portal form and paused.
  const canApprove = report && report.status === "awaiting_approval";
  const evidence = canApprove ? portalEvidence(runId, run?.trace) : null;
  const media = report ? filingMedia(runId, run?.trace, run?.output) : null;
  const locked = Boolean(report) && s.locked;
  const overdueHere = overdue.items.filter((i) => i.state === s.state);
  const owed = locked && VALID_STATES.includes(s.state) ? await remittanceOwed(db, companyId, s.state) : null;
  const filed = locked && VALID_STATES.includes(s.state) ? (await buildRunner(db, companyId, s.state)).receipt : null;
  const receipt = filed && filed.reportId === report?.id ? filed : null;
  // Catch-up mode: only when this state really has a late report (a stale link shows the normal page).
  const lateHere = catchup === "1" ? summarizeLateMoney(overdueHere, (st) => tryLoadRules(st)?.file ?? null, overdue.asOf).byState[0] : undefined;
  const catchUp = lateHere && lateHere.filingLateCount > 0 ? lateHere : null;
  const autoGenerate = Boolean(catchUp) && !report && s.toReportCount > 0;
  // The approval gate is offered once the agent has paused at the portal's submit step, or (catch-up) right after
  // generating, so the agent runs only after a person approved. Both go through the same server-enforced route.
  const showApprove = report && (canApprove || (catchUp !== null && report.status === "validated"));
  const acks = showApprove && report && VALID_STATES.includes(report.state) ? await approvalAcknowledgements(db, companyId, report.state) : null;

  return (
    <div>
      <StateTabs summaries={summaries} active={s.state} overdue={overdueByState} />
      {picked.filterMatched === false ? (
        <p className="-mt-4 mb-6 text-[13px] text-fg-2" data-testid="reports-filter-note">
          No approved {requested ? `${s.state} ` : ""}report is waiting to be filed. Showing {s.state}.
        </p>
      ) : picked.filterMatched ? (
        <p className="-mt-4 mb-6 text-[13px] text-fg-2" data-testid="reports-filter-note">
          {s.state} has an approved report waiting to be filed. Run the filing agent below.
        </p>
      ) : null}

      <div className="min-w-0 space-y-8" data-testid="report-detail">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-fg-1">{s.state} unclaimed property report</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">
              <span>Stage: {s.stage ?? "Unknown"}</span>
              {s.ruleVersion ? <RuleVersion version={s.ruleVersion} state={s.state} className="font-mono text-xs text-fg-3" /> : <span className="font-mono text-xs text-fg-3">no rule file</span>}
              {s.ruleUnverifiedCount > 0 ? <UnverifiedBadge /> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/chat?ask=${encodeURIComponent(closeOutPrompt(s.state))}`}
              data-testid="plan-close-out"
              className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2 px-3 max-sm:h-10")}
            >
              <ListChecks className="size-4" aria-hidden />
              Plan close-out
            </Link>
            <Link
              href={`/close-out/${s.state}`}
              data-testid="open-close-out-runner"
              className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2 border-blue-700 px-3 text-blue-300 hover:text-blue-200 max-sm:h-10")}
            >
              <Play className="size-4" aria-hidden />
              Close out {s.state}
            </Link>
            {locked && s.toReportCount === 0 ? null : (
              <GenerateButton state={s.state} mode={locked ? "next" : report ? "regenerate" : "generate"} disabled={s.toReportCount === 0} autoStart={autoGenerate} />
            )}
          </div>
        </header>

        {catchUp ? <CatchUpBanner late={catchUp} status={report?.status ?? null} generating={autoGenerate} /> : null}

        <OverdueReportNote state={s.state} items={overdueHere} />

        {/* R6-01: the filing record Reports shows is the receipt's, printed from the frozen record. */}
        {receipt ? <RunnerReceipt r={receipt} state={s.state} /> : null}

        {owed ? <RecordRemittance state={s.state} reportId={owed.reportId} count={owed.count} totalCents={owed.totalCents} remitDue={owed.remitDue} today={overdue.asOf} /> : null}

        <dl className="grid grid-cols-2 border-y border-line md:grid-cols-4">
          <Metric label="To report" index={0}>
            <AnimatedNumber value={s.toReportCount} />
          </Metric>
          <Metric label="Amount" index={1}>
            <AnimatedNumber value={s.toReportCents} currency />
          </Metric>
          <Metric label="Status" index={2}>
            {report ? <StatusPill status={report.status} /> : <span className="text-sm font-normal text-fg-3">Not generated</span>}
          </Metric>
          <Metric label="Generated" index={3}>
            <span className="text-sm font-normal">{report ? formatDate(report.createdAt.toISOString().slice(0, 10)) : <span className="text-fg-3">Never</span>}</span>
          </Metric>
        </dl>

        <section aria-labelledby="progress-h" className="border-t-0">
          <h3 id="progress-h" className="mb-5 text-sm font-medium text-fg-1">
            Filing progress
          </h3>
          <FilingStepper stages={stages} />
        </section>

        {s.toReportCount === 0 && !report ? (
          <EmptyState
            className="px-0 py-2"
            title={`No ${s.state} items are ready to report yet`}
            description="Items become ready to report when their due-diligence window closes. Fast-forward the demo clock from the header, or review what's still in progress."
            action={
              <Link href={`/items?state=${s.state}`} className="text-sm text-blue-400 underline underline-offset-2 hover:text-blue-300">
                See {s.state} items
              </Link>
            }
          />
        ) : null}

        {!report && s.toReportCount > 0 ? (
          <EmptyState
            className="px-0 py-2"
            title="Ready to generate"
            description={`${s.toReportCount} ${s.toReportCount === 1 ? "item is" : "items are"} ${overdueHere.length > 0 ? "to report, and the filing is late (see above)" : "ready to report"}. Generating builds the NAUPA file from the pinned ${s.state} rule version and checks it. Nothing is filed.`}
          />
        ) : null}

        {!report ? (
          <section aria-labelledby="ghost-h" className="border-t border-line pt-5" data-testid="validation-empty">
            <h3 id="ghost-h" className="text-sm font-medium text-fg-1">
              Validation
            </h3>
            <p className="mt-1.5 text-[13px] text-fg-2">
              {s.toReportCount > 0 ? "Not run yet. Generate the report to check it against the validator." : "Nothing to validate until items are ready to report."}
            </p>
          </section>
        ) : null}

        {report ? (
          <>
            {showApprove ? (
              <section aria-labelledby="approve-h" className="rounded-xl border border-pink-500/50 bg-ink-2 p-5" data-testid="approve-step">
                <h3 id="approve-h" className="text-sm font-medium text-fg-1">
                  Approve submission
                </h3>
                <p className="mt-1 mb-4 max-w-[60ch] text-sm text-fg-2">
                  {canApprove
                    ? "The filing agent has filled the replica portal and is paused before the final submit. Your approval covers exactly this file (checksum below); the agent submits only after you approve."
                    : "Review the validation and totals below. Your approval covers exactly this file (checksum below). The filing agent cannot start on this catch-up filing until you approve, and it files only on the replica portal."}
                </p>
                {evidence ? <PortalEvidencePanel evidence={evidence} reportCents={report.totalCents} reportCount={report.itemCount} /> : null}
                <ApproveReportButton reportId={report.id} checksum={report.checksum ?? ""} blocked={errorCount > 0} unverified={acks?.unverified ?? 0} unsent={acks?.unsent ?? 0} />
              </section>
            ) : null}

            <FilingPanel
              reportId={report.id}
              state={report.state}
              status={report.status}
              confirmation={report.replicaConfirmation}
              submittedAt={report.submittedAt?.toISOString() ?? null}
              initialRunId={runId}
              approveFirst={catchUp !== null}
            />

            {media ? <FilingMediaPanel media={media} /> : null}

            <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <Validation errors={errors} />
              <div className="min-w-0 space-y-8">
                <Reconciliation s={s} report={report} parsed={parsed} />
                <section aria-labelledby="files-h" className="border-t border-line pt-5">
                  <h3 id="files-h" className="mb-4 text-sm font-medium text-fg-1">
                    Files
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/api/reports/${report.id}/file`} download data-testid="download-file" className={cn(buttonVariants({ variant: "outline" }), "h-8 gap-2 px-3 max-sm:h-10")}>
                      <Download className="size-4" strokeWidth={1.5} aria-hidden /> NAUPA file (.txt)
                    </a>
                    <a href={`/api/reports/${report.id}/evidence`} download data-testid="download-evidence" className={cn(buttonVariants({ variant: "outline" }), "h-8 gap-2 px-3 max-sm:h-10")}>
                      <FileText className="size-4" strokeWidth={1.5} aria-hidden /> Evidence pack (PDF)
                    </a>
                  </div>
                  {report.checksum ? (
                    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
                      sha256 <span className="font-mono break-all">{report.checksum}</span>
                      <CopyButton value={report.checksum} />
                    </p>
                  ) : null}
                </section>
              </div>
            </div>
          </>
        ) : null}

        {locked ? (
          <p className="text-sm text-fg-2" data-testid="report-locked">
            This {report!.reportYear} report is submitted and locked.{s.toReportCount > 0 ? ` ${s.toReportCount} newer ${s.toReportCount === 1 ? "item is" : "items are"} waiting: start the next report.` : ""}
          </p>
        ) : null}

        {s.history.length > 0 ? (
          <p className="text-xs text-fg-3">
            {s.history.length} earlier {s.history.length > 1 ? "reports" : "report"} for {s.state} {s.history.length > 1 ? "are" : "is"} kept for the audit trail.
          </p>
        ) : null}
      </div>
    </div>
  );
}
