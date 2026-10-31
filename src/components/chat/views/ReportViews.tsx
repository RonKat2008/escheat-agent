"use client";

import { BadgeDollarSign, ChevronRight, CircleAlert, FileSpreadsheet, FileStack } from "lucide-react";
import { Money, StatusPill } from "@/components/primitives";
import type { RecoveriesUi, ReportsUi, ReportUi } from "@/lib/chat/ui-types";
import { AskButton, AttentionNote, fmtDate, FooterLink, UnverifiedFlag, ViewCard } from "./parts";

export function ReportsView({ states }: ReportsUi["props"]) {
  return (
    <ViewCard testId="view-reports" icon={<FileStack />} title="State reports" footer={<FooterLink href="/reports">Open Reports</FooterLink>}>
      <ul className="divide-y divide-[var(--chat-line)]">
        {states.map((s) => (
          <li key={s.state} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-[13px]">
            <span className="font-semibold text-[var(--chat-t1)]">{s.state}</span>
            <span className="min-w-0">
              <span className="block text-[var(--chat-t1)] tabular-nums">
                {s.toReportCount} to report{s.toReportCount ? <>, <Money cents={s.toReportCents} /></> : ""}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--chat-t3)]">
                {s.latest ? `Latest: ${s.latest.status.replaceAll("_", " ")}, ${fmtDate(s.latest.createdAt.slice(0, 10))}` : "No report generated yet"}
                {s.ruleUnverifiedCount ? <UnverifiedFlag compact /> : null}
              </span>
            </span>
            {s.toReportCount > 0 ? (
              <AskButton question={`Generate the ${s.state} report`}>Generate</AskButton>
            ) : (
              <span className="text-xs text-[var(--chat-t3)]">Nothing due yet</span>
            )}
          </li>
        ))}
      </ul>
    </ViewCard>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ReportView(r: ReportUi["props"]) {
  const errors = r.errors.filter((e) => e.severity === "error");
  const warnings = [...r.errors.filter((e) => e.severity !== "error").map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)), ...r.warnings];
  const held = r.heldForReview;
  const valid = r.status === "validated";
  return (
    <ViewCard
      testId="view-report"
      icon={<FileSpreadsheet />}
      title={`${r.state} NAUPA report${r.stage ? `, ${r.stage}` : ""}`}
      meta={r.checksum ? <span className="font-mono">sha256 {r.checksum.slice(0, 10)}</span> : undefined}
      footer={
        held ? (
          <>
            <span className="text-xs text-[var(--chat-t3)]">Nothing was regenerated or filed.</span>
            <span className="flex-1" />
            <FooterLink href={held.href}>{held.linkLabel}</FooterLink>
          </>
        ) : (
          <>
            <span className="text-xs text-[var(--chat-t3)]">Generated and validated only. Nothing was filed.</span>
            <span className="flex-1" />
            <FooterLink href={`/api/reports/${r.reportId}/evidence`} external>
              Evidence pack
            </FooterLink>
            <FooterLink href={`/reports?state=${r.state}`}>File from Reports</FooterLink>
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        {held || valid ? (
          <StatusPill status={r.status} />
        ) : (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-[6px] border border-[var(--chat-pink)] bg-[var(--chat-pink-900)] px-2 text-xs font-medium text-[var(--chat-t1)]">
            <CircleAlert className="size-3.5 text-[var(--chat-pink-text)]" aria-hidden />
            {plural(errors.length, "validation error")}
          </span>
        )}
        <span className="text-[13px] text-[var(--chat-t3)]">
          <span className="text-lg font-semibold text-[var(--chat-t1)] tabular-nums">
            <Money cents={r.totalCents} />
          </span>{" "}
          across {plural(r.itemCount, "item")}
        </span>
        {r.excludedCount ? <span className="text-xs text-[var(--chat-t3)]">{r.excludedCount} excluded</span> : null}
      </div>
      {held ? (
        <div className="border-t border-[var(--chat-line)] px-4 py-3" data-testid="report-held">
          <AttentionNote>{held.notice}</AttentionNote>
        </div>
      ) : null}
      {errors.length ? (
        <div className="space-y-1.5 border-t border-[var(--chat-line)] px-4 py-3">
          {errors.map((e, i) => (
            <AttentionNote key={`e${i}`}>{e.field ? `${e.field}: ${e.message}` : e.message}</AttentionNote>
          ))}
        </div>
      ) : null}
      {warnings.length ? (
        <details className="group border-t border-[var(--chat-line)]">
          <summary className="chat-focus flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-4 text-[13px] text-[var(--chat-t2)] select-none hover:text-[var(--chat-t1)] [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 text-[var(--chat-t3)] transition-transform duration-150 group-open:rotate-90" strokeWidth={1.5} aria-hidden />
            {plural(warnings.length, "warning")}
            <span className="text-xs text-[var(--chat-t3)]">optional fields and notes; they do not block filing</span>
          </summary>
          <ul className="max-h-56 space-y-1 overflow-y-auto px-4 pb-3 pl-9">
            {warnings.map((w, i) => (
              <li key={`w${i}`} className="font-mono text-[11.5px] leading-5 break-words text-[var(--chat-t3)]">
                {w}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </ViewCard>
  );
}

export function RecoveriesView({ recoveries }: RecoveriesUi["props"]) {
  const total = recoveries.reduce((s, r) => s + r.amountCents, 0);
  return (
    <ViewCard
      testId="view-recoveries"
      icon={<BadgeDollarSign />}
      title="Money owed back to you"
      meta={recoveries.length ? <Money cents={total} /> : undefined}
      footer={<FooterLink href="/recoveries">Open Recoveries</FooterLink>}
    >
      {recoveries.length === 0 ? (
        <div className="space-y-3 px-4 py-5">
          <p className="text-sm text-[var(--chat-t3)]">No recoveries found yet. The recovery agent searches the replica state portals for the company&apos;s name variants.</p>
          <AskButton question="Search the replica portals for money owed to us">Run the recovery search</AskButton>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--chat-line)]">
          {recoveries.map((r) => (
            <li key={r.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-[13px]">
              <span className="font-semibold text-[var(--chat-t1)]">{r.state}</span>
              <span className="min-w-0">
                <span className="block truncate text-[var(--chat-t1)]">{r.holderNameFound ?? r.matchedNameVariant ?? "Name match"}</span>
                <span className="block text-xs text-[var(--chat-t3)]">
                  {r.matchConfidence !== null ? `${Math.round(r.matchConfidence <= 1 ? r.matchConfidence * 100 : r.matchConfidence)}% match, ` : ""}
                  {r.approvedBy ? `claim approved by ${r.approvedBy}` : null}
                </span>
              </span>
              <span className="flex flex-col items-end gap-0.5 text-[var(--chat-t1)]">
                <Money cents={r.amountCents} />
                <StatusPill status={r.status} className="text-xs" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </ViewCard>
  );
}
