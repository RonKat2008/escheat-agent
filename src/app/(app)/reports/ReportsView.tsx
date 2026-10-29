import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { CheckCircle2, CircleAlert, Download, FileText, Info } from "lucide-react";
import { CopyButton } from "@/components/b/CopyButton";
import { EmptyState, Money, StatusPill, UnverifiedBadge } from "@/components/primitives";
import { agentRuns, type Report } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { parseNaupaReport, type ParsedReport } from "@/lib/reports/parse";
import { listReportSummaries, type StateReportSummary } from "@/lib/reports/service";
import type { ValidationError } from "@/lib/reports/validate";
import { cn } from "@/lib/utils";
import { getCtx } from "@/lib/ui/ctx";
import { FilingPanel } from "./FilingPanel";
import { ApproveReportButton, GenerateButton } from "./ReportActions";

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

function StateRow({ s, active }: { s: StateReportSummary; active: boolean }) {
  return (
    <Link
      href={`/reports?state=${s.state}`}
      aria-current={active ? "true" : undefined}
      scroll={false}
      className={cn(
        "relative block rounded-xl px-3.5 py-3 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-raised" : "hover:bg-raised/60",
      )}
    >
      {active ? <span aria-hidden className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-at-risk" /> : null}
      <span className="flex items-center justify-between gap-3">
        <span className="font-mono text-lg font-semibold tracking-wide">{s.state}</span>
        {s.latest ? <StatusPill status={s.latest.status} /> : <span className="text-xs text-muted-foreground">No report yet</span>}
      </span>
      <span className="mt-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground">{s.toReportCount}</span> to report
        </span>
        <Money cents={s.toReportCents} className="text-[13px]" muted={s.toReportCount === 0} />
      </span>
    </Link>
  );
}

interface IssueRow {
  field: string;
  message: string;
  records: number[];
}

function groupWarnings(warns: ValidationError[]): IssueRow[] {
  const map = new Map<string, IssueRow>();
  for (const w of warns) {
    const k = `${w.field}|${w.message}`;
    const prev = map.get(k);
    map.set(k, prev ? { ...prev, records: [...prev.records, w.record] } : { field: w.field, message: w.message, records: [w.record] });
  }
  return [...map.values()];
}

function recordsLabel(r: number[]): string {
  if (r.length === 1) return r[0] === 0 ? "File" : String(r[0]);
  return `${r.length} records`;
}

function IssueTable({ rows, tone, bare }: { rows: IssueRow[]; tone: "error" | "warning"; bare?: boolean }) {
  return (
    <div className={cn("overflow-x-auto", !bare && "rounded-xl border border-border")}>
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="bg-sunken text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Record</th>
            <th scope="col" className="px-3 py-2 font-medium">Field</th>
            <th scope="col" className="px-3 py-2 font-medium">{tone === "error" ? "Problem" : "Note"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.field}${e.message}${e.records[0]}`} className="border-t border-border align-top">
              <td className={cn("px-3 py-2 font-mono tabular-nums", tone === "error" && "text-danger")}>{recordsLabel(e.records)}</td>
              <td className="px-3 py-2 font-mono text-xs">{e.field}</td>
              <td className="max-w-[52ch] px-3 py-2">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Validation({ errors }: { errors: ValidationError[] }) {
  const errs = errors.filter((e) => e.severity === "error");
  const warns = errors.filter((e) => e.severity === "warning");
  return (
    <section aria-labelledby="validation-h">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="validation-h" className="text-[15px] font-semibold">
          Validation
        </h3>
        <span className={cn("inline-flex items-center gap-1.5 text-sm", errs.length ? "text-danger" : "text-resolved")} data-testid="validation-summary">
          {errs.length ? <CircleAlert className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
          {errs.length ? `${errs.length} error${errs.length > 1 ? "s" : ""}` : "Passed with no errors"}
          {warns.length ? <span className="text-muted-foreground">· {warns.length} warning{warns.length > 1 ? "s" : ""}</span> : null}
        </span>
      </div>
      {errors.length === 0 ? (
        <p className="text-sm text-muted-foreground">Record layout, totals, property codes and dates all match the state rule file.</p>
      ) : null}
      {errs.length > 0 ? <IssueTable rows={errs.map((e) => ({ field: e.field, message: e.message, records: [e.record] }))} tone="error" /> : null}
      {warns.length > 0 ? (
        <details className="group mt-3 rounded-xl border border-border">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>
              {groupWarnings(warns).length} optional fields are blank across {warns.length} entries. These do not block filing.
            </span>
            <span className="text-xs underline underline-offset-2 group-open:hidden">Show</span>
            <span className="hidden text-xs underline underline-offset-2 group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-border">
            <IssueTable rows={groupWarnings(warns)} tone="warning" bare />
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Reconciliation({ s, report, parsed }: { s: StateReportSummary; report: Report; parsed: ParsedReport | null }) {
  const fileTotal = parsed?.summary?.amountReportedCents ?? null;
  const rows = [
    { label: "Items in To Report now", count: s.toReportCount, cents: s.toReportCents },
    { label: "Report row", count: report.itemCount, cents: report.totalCents },
    { label: "NAUPA file (summary record)", count: parsed ? parsed.properties.length : null, cents: fileTotal, note: "records" },
  ];
  const matches = rows.every((r) => r.cents === null || r.cents === rows[0]!.cents);
  return (
    <section aria-labelledby="recon-h">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="recon-h" className="text-[15px] font-semibold">
          Totals reconciliation
        </h3>
        <span className={cn("inline-flex items-center gap-1.5 text-sm", matches ? "text-resolved" : "text-at-risk")}>
          {matches ? <CheckCircle2 className="size-4" aria-hidden /> : <Info className="size-4" aria-hidden />}
          {matches ? "All three agree" : "Items changed since this report was generated. Regenerate."}
        </span>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="flex items-baseline gap-4 whitespace-nowrap">
              {r.count !== null ? (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {r.count} {r.note ?? "items"}
                </span>
              ) : null}
              {r.cents !== null ? <Money cents={r.cents} /> : <span className="text-muted-foreground italic">Unknown</span>}
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
  // The single human gate: "Approve submission" is offered once the agent has filled the portal form and paused.
  const canApprove = report && report.status === "awaiting_approval";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <nav aria-label="States" className="rounded-[14px] border border-border bg-surface p-2">
        <h2 className="px-3.5 pt-2 pb-1.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">States</h2>
        <div className="space-y-0.5">
          {summaries.map((x) => (
            <StateRow key={x.state} s={x} active={x.state === s.state} />
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-6 rounded-[14px] border border-border bg-surface p-5" data-testid="report-detail">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {s.state} unclaimed property report
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>Stage: {s.stage ?? "Unknown"}</span>
              <span className="font-mono text-xs">rule {s.ruleVersion ?? "none"}</span>
              {s.ruleUnverifiedCount > 0 ? <UnverifiedBadge /> : null}
            </p>
          </div>
          <GenerateButton state={s.state} hasReport={Boolean(report)} disabled={s.toReportCount === 0} />
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <div>
            <dt className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">To report</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{s.toReportCount}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Amount</dt>
            <dd className="mt-1 text-2xl font-semibold"><Money cents={s.toReportCents} /></dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Report status</dt>
            <dd className="mt-1.5">{report ? <StatusPill status={report.status} /> : <span className="text-sm text-muted-foreground">Not generated</span>}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Generated</dt>
            <dd className="mt-1 text-sm">{report ? formatDate(report.createdAt.toISOString().slice(0, 10)) : "Never"}</dd>
          </div>
        </dl>

        {s.toReportCount === 0 && !report ? (
          <EmptyState
            className="px-0 py-2"
            title={`No ${s.state} items are in To Report yet`}
            description="Items move to To Report when their due-diligence window closes. Fast-forward the demo clock from the header, or review what's still in progress."
            action={
              <Link href={`/items?state=${s.state}`} className="text-sm underline underline-offset-2 hover:text-foreground">
                See {s.state} items
              </Link>
            }
          />
        ) : null}

        {!report && s.toReportCount > 0 ? (
          <EmptyState
            className="px-0 py-2"
            title="Ready to generate"
            description={`${s.toReportCount} ${s.toReportCount === 1 ? "item is" : "items are"} in To Report. Generating builds the NAUPA file from the pinned ${s.state} rule version and checks it. Nothing is filed.`}
          />
        ) : null}

        {report ? (
          <>
            <Validation errors={errors} />
            <Reconciliation s={s} report={report} parsed={parsed} />

            <section aria-labelledby="files-h">
              <h3 id="files-h" className="mb-2 text-[15px] font-semibold">
                Files
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/reports/${report.id}/file`}
                  download
                  data-testid="download-file"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-strong px-3.5 text-sm font-medium hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:h-11"
                >
                  <Download className="size-4" aria-hidden /> NAUPA file (.txt)
                </a>
                <a
                  href={`/api/reports/${report.id}/evidence`}
                  download
                  data-testid="download-evidence"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-strong px-3.5 text-sm font-medium hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:h-11"
                >
                  <FileText className="size-4" aria-hidden /> Evidence pack (PDF)
                </a>
              </div>
              {report.checksum ? (
                <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  sha256 <span className="font-mono break-all">{report.checksum}</span>
                  <CopyButton value={report.checksum} />
                </p>
              ) : null}
            </section>

            {canApprove ? (
              <section aria-labelledby="approve-h" className="rounded-xl border border-border bg-sunken p-4">
                <h3 id="approve-h" className="text-[15px] font-semibold">
                  Approve submission
                </h3>
                <p className="mt-1 mb-3 max-w-[60ch] text-sm text-muted-foreground">
                  The filing agent has filled the replica portal and is paused before the final submit. Your approval covers exactly this file (checksum above); the agent submits only after you approve.
                </p>
                <ApproveReportButton reportId={report.id} checksum={report.checksum ?? ""} blocked={errors.some((e) => e.severity === "error")} />
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
          </>
        ) : null}

        {s.history.length > 0 ? (
          <p className="text-xs text-muted-foreground">{s.history.length} earlier report{s.history.length > 1 ? "s" : ""} for {s.state} are kept for the audit trail.</p>
        ) : null}
      </div>
    </div>
  );
}
