"use client";

import { BadgeDollarSign, CircleCheck, FileSpreadsheet, FileStack } from "lucide-react";
import type { RecoveriesUi, ReportsUi, ReportUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { AskButton, AttentionNote, fmtDate, FooterLink, UnverifiedFlag, usd, ViewCard } from "./parts";

export function ReportsView({ states }: ReportsUi["props"]) {
  return (
    <ViewCard testId="view-reports" icon={<FileStack />} title="State reports" footer={<FooterLink href="/reports">Open Reports</FooterLink>}>
      <ul className="divide-y divide-[var(--chat-line)]">
        {states.map((s) => (
          <li key={s.state} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-[13px]">
            <span className="font-semibold text-[var(--chat-t1)]">{s.state}</span>
            <span className="min-w-0">
              <span className="block text-[var(--chat-t1)] tabular-nums">
                {s.toReportCount} to report{s.toReportCount ? `, ${usd(s.toReportCents)}` : ""}
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

export function ReportView(r: ReportUi["props"]) {
  const errors = r.errors.filter((e) => e.severity === "error");
  const warnings = [...r.errors.filter((e) => e.severity !== "error").map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)), ...r.warnings];
  const valid = r.status === "validated";
  return (
    <ViewCard
      testId="view-report"
      icon={<FileSpreadsheet />}
      title={`${r.state} NAUPA report${r.stage ? `, ${r.stage}` : ""}`}
      meta={r.checksum ? <span className="font-mono">sha256 {r.checksum.slice(0, 10)}</span> : undefined}
      footer={
        <>
          <span className="text-xs text-[var(--chat-t3)]">Generated and validated only. Nothing was filed.</span>
          <span className="flex-1" />
          <FooterLink href={`/api/reports/${r.reportId}/evidence`} external>
            Evidence pack
          </FooterLink>
          <FooterLink href={`/reports?state=${r.state}`}>File from Reports</FooterLink>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1.5 text-xs font-medium",
            valid ? "text-[var(--chat-t2)] [&>svg]:text-[var(--chat-blue-500)]" : "rounded-[6px] border border-[var(--chat-pink)] bg-[var(--chat-pink-900)] px-2 text-[var(--chat-t1)] [&>svg]:text-[var(--chat-pink-text)]",
          )}
        >
          <CircleCheck className="size-3.5" aria-hidden />
          {valid ? "Validated" : `${errors.length} validation ${errors.length === 1 ? "error" : "errors"}`}
        </span>
        <span className="text-[13px] text-[var(--chat-t3)]">
          <span className="text-lg font-semibold text-[var(--chat-t1)] tabular-nums">{usd(r.totalCents)}</span> across {r.itemCount} items
        </span>
        {r.excludedCount ? <span className="text-xs text-[var(--chat-t3)]">{r.excludedCount} excluded</span> : null}
      </div>
      {errors.length || warnings.length ? (
        <div className="max-h-56 space-y-1.5 overflow-y-auto border-t border-[var(--chat-line)] px-4 py-3">
          {errors.map((e, i) => (
            <AttentionNote key={`e${i}`}>{e.field ? `${e.field}: ${e.message}` : e.message}</AttentionNote>
          ))}
          {warnings.map((w, i) => (
            <p key={`w${i}`} className="text-xs text-pretty text-[var(--chat-t3)]">
              {w}
            </p>
          ))}
        </div>
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
      meta={recoveries.length ? usd(total) : undefined}
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
                  {r.matchConfidence !== null ? `${Math.round(r.matchConfidence * 100)}% match, ` : ""}
                  {r.approvedBy ? `claim approved by ${r.approvedBy}` : r.status.replaceAll("_", " ")}
                </span>
              </span>
              <span className="text-[var(--chat-t1)] tabular-nums">{usd(r.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </ViewCard>
  );
}
