import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { CheckCircle2, Download, FileText, Info } from "lucide-react";
import { CopyButton } from "@/components/b/CopyButton";
import { EmptyState, AnimatedNumber, Money, StatusPill, UnverifiedBadge } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import { agentRuns, type Report } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { parseNaupaReport, type ParsedReport } from "@/lib/reports/parse";
import { listReportSummaries, type StateReportSummary } from "@/lib/reports/service";
import type { ValidationError } from "@/lib/reports/validate";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import { FilingPanel } from "./FilingPanel";
import { FilingStepper } from "./FilingStepper";
import { ApproveReportButton, GenerateButton } from "./ReportActions";
import { Validation, ValidationGhost } from "./ValidationLists";

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
function StateTabs({ summaries, active }: { summaries: StateReportSummary[]; active: string }) {
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
  const fileTotal = parsed?.summary?.amountReportedCents ?? null;
  const rows = [
    { label: "Items to report now", count: s.toReportCount, cents: s.toReportCents },
    { label: "Report row", count: report.itemCount, cents: report.totalCents },
    { label: "NAUPA file (summary record)", count: parsed ? parsed.properties.length : null, cents: fileTotal, note: "record" },
  ];
  const matches = rows.every((r) => r.cents === null || r.cents === rows[0]!.cents);
  return (
    <section aria-labelledby="recon-h" className="min-w-0 border-t border-line pt-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="recon-h" className="text-sm font-medium text-fg-1">
          Totals reconciliation
        </h3>
        <span className={cn("inline-flex items-center gap-1.5 text-[13px]", matches ? "text-blue-400" : "text-pink-400")}>
          {matches ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
          {matches ? "All three agree" : "Items changed since this report was generated. Regenerate."}
        </span>
      </div>
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

async function latestRunId(db: Awaited<ReturnType<typeof getCtx>>["db"], reportId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agent, "filing_agent"), sql`${agentRuns.input}->>'reportId' = ${reportId}`))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  return row?.id ?? null;
}

export async function ReportsView({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state: requested } = await searchParams;
  const { db, companyId } = await getCtx();
  const summaries = await listReportSummaries(db, companyId);
  const pick = requested?.toUpperCase();
  const s =
    summaries.find((x) => x.state === pick && VALID_STATES.includes(x.state)) ??
    summaries.find((x) => x.toReportCount > 0 || x.latest) ??
    summaries[0]!;
  const report = s.latest;
  const parsed = report ? await parsedFile(report) : null;
  const runId = report ? await latestRunId(db, report.id) : null;
  const errors = ((report?.validationErrors ?? []) as ValidationError[]).filter(Boolean);
  const errorCount = errors.filter((e) => e.severity === "error").length;
  // The single human gate: "Approve submission" is offered once the agent has filled the portal form and paused.
  const canApprove = report && report.status === "awaiting_approval";

  return (
    <div>
      <StateTabs summaries={summaries} active={s.state} />

      <div className="min-w-0 space-y-8" data-testid="report-detail">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-fg-1">{s.state} unclaimed property report</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-2">
              <span>Stage: {s.stage ?? "Unknown"}</span>
              <span className="font-mono text-xs text-fg-3">rule {s.ruleVersion ?? "none"}</span>
              {s.ruleUnverifiedCount > 0 ? <UnverifiedBadge /> : null}
            </p>
          </div>
          <GenerateButton state={s.state} hasReport={Boolean(report)} disabled={s.toReportCount === 0} />
        </header>

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
          <FilingStepper report={report} errorCount={errorCount} />
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
            description={`${s.toReportCount} ${s.toReportCount === 1 ? "item is" : "items are"} ready to report. Generating builds the NAUPA file from the pinned ${s.state} rule version and checks it. Nothing is filed.`}
          />
        ) : null}

        {!report ? (
          <section aria-labelledby="ghost-h" className="border-t border-line pt-5">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
              <h3 id="ghost-h" className="text-sm font-medium text-fg-1">
                Validation
              </h3>
              <span className="text-[13px] text-fg-3">Results appear here once the report is generated.</span>
            </div>
            <ValidationGhost />
          </section>
        ) : null}

        {report ? (
          <>
            {canApprove ? (
              <section aria-labelledby="approve-h" className="rounded-xl border border-pink-500/50 bg-ink-2 p-5">
                <h3 id="approve-h" className="text-sm font-medium text-fg-1">
                  Approve submission
                </h3>
                <p className="mt-1 mb-4 max-w-[60ch] text-sm text-fg-2">
                  The filing agent has filled the replica portal and is paused before the final submit. Your approval covers exactly this file (checksum below); the agent submits only after you approve.
                </p>
                <ApproveReportButton reportId={report.id} checksum={report.checksum ?? ""} blocked={errorCount > 0} />
              </section>
            ) : null}

            <FilingPanel
              reportId={report.id}
              state={report.state}
              status={report.status}
              confirmation={report.replicaConfirmation}
              submittedAt={report.submittedAt?.toISOString() ?? null}
              initialRunId={runId}
            />

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

        {s.history.length > 0 ? (
          <p className="text-xs text-fg-3">
            {s.history.length} earlier report{s.history.length > 1 ? "s" : ""} for {s.state} are kept for the audit trail.
          </p>
        ) : null}
      </div>
    </div>
  );
}
