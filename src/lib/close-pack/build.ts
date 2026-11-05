/**
 * Builds the month-end close pack. Reuses the generators the individual exports call: journalCsv (GET /api/ledger.csv),
 * exportActivity (GET /api/activity.csv), buildAuditBinder over loadAuditDrill (GET /api/audit/:state/binder, one
 * binder per audit state merged into one PDF). The roll-forward PDF and the tie-out are new; the ZIP is STORE-only.
 */
import { PDFDocument } from "pdf-lib";
import type { Db } from "@/db/client";
import { exportActivity } from "@/lib/activity-export";
import { buildAuditBinder } from "@/lib/audit/binder";
import { AUDIT_STATES, DEFAULT_SAMPLE_SIZE } from "@/lib/audit/sample";
import { sha256Hex } from "@/lib/crypto";
import { journalCsv } from "@/lib/ledger/csv";
import { allMovements } from "@/lib/ledger/movements";
import { outstandingAt } from "@/lib/ledger/rollforward";
import { loadAuditDrill } from "@/lib/queries/audit";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";
import { buildChain, verifyChain } from "./chain";
import { buildRollForwardPdf, buildTieOutPdf, CLOSE_PACK_DISCLAIMER } from "./pdf";
import { monthPeriod } from "./period";
import { allTie, computeTieOut, type PackFile, type TieLine } from "./tieout";
import { zipStore } from "./zip";

export const CLOSE_PACK_FILE_COUNT = 6;

export interface ClosePackManifest {
  period: string;
  periodStart: string;
  periodEnd: string;
  demoDate: string;
  synthetic: true;
  disclaimer: string;
  files: PackFile[];
  note: string;
  auditChain: { kind: string; length: number; headHash: string; verified: boolean };
  tieOut: { allTie: boolean; tie: number; doesNotTie: number; notAvailable: number };
}

export interface ClosePack {
  zip: Uint8Array;
  manifest: ClosePackManifest;
  tieLines: TieLine[];
  /** Every file in the ZIP, in order. */
  files: { name: string; data: Uint8Array }[];
}

export type ClosePackResult = { ok: true; pack: ClosePack } | { ok: false; status: number; error: string };

const enc = new TextEncoder();
const fileOf = (name: string, data: Uint8Array): PackFile => ({ name, sha256: sha256Hex(data), bytes: data.length });

async function mergedBinder(db: Db, companyId: string): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle("Audit binder (synthetic data)");
  out.setProducer("Escheat Agent prototype");
  for (const state of AUDIT_STATES) {
    const drill = await loadAuditDrill(db, companyId, { state, size: DEFAULT_SAMPLE_SIZE, all: false });
    const src = await PDFDocument.load(await buildAuditBinder(drill));
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return out.save();
}

export async function buildClosePack(db: Db, companyId: string, month: string | null): Promise<ClosePackResult> {
  const data = await loadLedger(db, companyId);
  const ym = month ?? data.today.slice(0, 7);
  const p = monthPeriod(ym, data.today);
  if (!p.ok) return { ok: false, status: 400, error: p.error };
  const { period } = p;

  const view = computeLedger(data, "month", period);
  const movements = allMovements(data.items, data.history, data.today);
  const payable = new Map<string, number>();
  for (const s of view.roll.states) payable.set(s.state, 0);
  for (const m of outstandingAt(movements, period.end)) payable.set(m.state, (payable.get(m.state) ?? 0) + m.amountCents);

  const activity = await exportActivity(db, companyId, { from: period.start, to: period.end });
  const chain = buildChain(activity.csvLines);
  const verified = verifyChain(activity.csv, chain);

  const journal = enc.encode(journalCsv(view.journal.entries));
  const rollforward = await buildRollForwardPdf({
    periodLabel: period.label,
    start: period.start,
    end: period.end,
    demoDate: data.today,
    states: view.roll.states,
    total: view.roll.total,
  });
  const binder = await mergedBinder(db, companyId);
  const activityBytes = enc.encode(activity.csv);

  const named = [
    { name: `journal-${ym}.csv`, data: journal },
    { name: `rollforward-${ym}.pdf`, data: rollforward },
    { name: "audit-binder.pdf", data: binder },
    { name: `activity-${ym}.csv`, data: activityBytes },
  ];
  const listed = named.map((f) => fileOf(f.name, f.data));
  const csvRows = activity.csvLines.length;
  const tieLines = computeTieOut({
    journal: view.journal,
    roll: view.roll,
    payableByState: payable,
    activity: { csvRows, loadedRows: activity.rows.length, truncated: activity.truncated },
    chain: { ...chain, verified },
    files: listed,
  });
  const tieout = await buildTieOutPdf({ periodLabel: period.label, demoDate: data.today, lines: tieLines });
  const tieName = `tie-out-${ym}.pdf`;

  const manifest: ClosePackManifest = {
    period: ym,
    periodStart: period.start,
    periodEnd: period.end,
    demoDate: data.today,
    synthetic: true,
    disclaimer: CLOSE_PACK_DISCLAIMER,
    files: [...listed, fileOf(tieName, tieout)],
    note: "manifest.json cannot list its own hash. The audit chain is derived from the Activity CSV rows in this pack (the prototype stores no tamper-evident log): link = sha256(previous link + newline + sha256(row)), from 64 zeros.",
    auditChain: { kind: "derived-from-activity-csv", length: chain.length, headHash: chain.head, verified },
    tieOut: {
      allTie: allTie(tieLines),
      tie: tieLines.filter((l) => l.status === "tie").length,
      doesNotTie: tieLines.filter((l) => l.status === "no_tie").length,
      notAvailable: tieLines.filter((l) => l.status === "n/a").length,
    },
  };
  const files = [...named, { name: tieName, data: tieout }, { name: "manifest.json", data: enc.encode(`${JSON.stringify(manifest, null, 2)}\n`) }];
  return { ok: true, pack: { zip: zipStore(files), manifest, tieLines, files } };
}
