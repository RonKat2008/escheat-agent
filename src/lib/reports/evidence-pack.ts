/**
 * Evidence pack PDF: what a reviewer needs to defend a filing. Cover page (holder, state, period,
 * totals, prototype banner), one page per item (rule-engine timeline with rule version + sources,
 * outreach log, owner responses) and an appendix of every rule value used with its source and
 * verified flag. Unverified rule values are marked UNVERIFIED everywhere they appear.
 *
 * Once the report is filed the cover also carries the Filing section an auditor asks for (R5-12): the replica
 * confirmation number, the portal, who approved it and when (bound to the file checksum), when it was submitted, how
 * late it was and the late interest disclosed, the same facts the close-out receipt shows.
 *
 * Text is drawn with the standard Helvetica fonts (WinAnsi), which include "§" and curly quotes; anything outside
 * that set is transliterated (never silently turned into "?" when a readable form exists).
 */

import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { RuleFile } from "../../../rules/schema";
import { PROPERTY_TYPES } from "../../../rules/schema";
import { formatUSD } from "../money";
import type { DatedValue, Timeline } from "../rules/engine";
import { listRuleValues, listRuleValuesFor } from "../rules/values";
import type { StateInterest } from "./late-money";
import type { NaupaReportResult, ReportItem } from "./naupa";

export interface OutreachEntry {
  channel: string; // letter | email | call | ...
  at: string; // ISO timestamp or date
  status: string;
  to?: string;
  summary?: string;
  /** Lob TEST-mode letter id and preview URL. */
  lobLetterId?: string;
  lobUrl?: string;
  emailId?: string;
}

export interface OwnerResponseEntry {
  at: string;
  channel: string;
  summary: string;
}

export interface EvidenceItem {
  item: ReportItem;
  timeline: Timeline | null;
  outreach: readonly OutreachEntry[];
  ownerResponses: readonly OwnerResponseEntry[];
}

/** A date the rules engine computed, with whether a person has verified the rule values behind it. */
export interface SourcedDate {
  date: string;
  unverified: boolean;
}

/** What was filed, as the close-out receipt shows it. Absent: the report has not been submitted yet. */
export interface EvidenceFiling {
  /** "Replica TX holder portal": never a real state system. */
  portal: string;
  confirmation: string | null;
  /** sha256 of the NAUPA file the approval is bound to. */
  checksum: string | null;
  approvedBy: string | null;
  /** ISO timestamp (system clock). */
  approvedAt: string | null;
  /** ISO timestamp (system clock). */
  submittedAt: string | null;
  reportDue: SourcedDate | null;
  /** Days past the report due date on the demo date; null when on time or the due date is unknown. */
  daysLate: number | null;
  interest: StateInterest;
  remitDue: SourcedDate | null;
  /** The recorded remittance (R5-05), once a person records it. */
  remittance?: { remittedOn: string; reference: string | null; by: string; itemCount: number; totalCents: number } | null;
}

export interface EvidencePackInput {
  report: NaupaReportResult;
  items: readonly EvidenceItem[];
  ruleFiles: readonly RuleFile[];
  /** Default: now. Pass a fixed value for a reproducible PDF. */
  generatedAt?: Date;
  /** The app's (demo) date the pack describes. Default: the report period's end. */
  asOf?: string;
  /** Present once the report is filed. */
  filing?: EvidenceFiling | null;
}

export interface EvidencePack {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  /** Rule values and timeline dates marked UNVERIFIED in the pack. */
  unverifiedCount: number;
}

export const BANNER = "PROTOTYPE  |  SYNTHETIC DATA  |  NOT LEGAL ADVICE";
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;

/** Readable stand-ins for characters the standard fonts cannot draw. */
const TRANSLIT: Readonly<Record<string, string>> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": ",",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
  "\u00a7": "Sec.",
  "\u00b6": "Para.",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u00a0": " ",
  "\u202f": " ",
  "\u2009": " ",
};

/**
 * Makes `s` drawable with a font whose code points are `charset`: characters the font has are kept as they are
 * (Helvetica's WinAnsi set has "§", curly quotes, dashes and accented letters), others are transliterated, then stripped
 * of accents, and only then shown as "?".
 */
export function pdfSafe(s: string, charset: ReadonlySet<number>): string {
  let out = "";
  const has = (t: string) => [...t].every((c) => charset.has(c.codePointAt(0)!));
  for (const ch of s.replace(/\r\n?/g, "\n")) {
    if (ch === "\n" || has(ch)) {
      out += ch;
      continue;
    }
    const t = TRANSLIT[ch];
    if (t !== undefined && has(t)) {
      out += t;
      continue;
    }
    const bare = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += bare && has(bare) ? bare : "?";
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-11-01" -> "Nov 1, 2026"; anything else is returned unchanged. */
export function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

/** A system-clock instant as "Nov 4, 2026 00:56 UTC". */
export function fmtInstant(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  const iso = d.toISOString();
  return `${fmtDay(iso)} ${iso.slice(11, 16)} UTC`;
}

/** Top of the first text line, below the banner (which ends at PAGE_H - 22). */
const TOP = PAGE_H - 44;
/** Line box = size * LINE; the baseline sits ASCENT * size below the line's top. */
const LINE = 1.3;
const ASCENT = 0.9;

/**
 * Lays text out top-down. `y` is the TOP of the next line (not a baseline), and each line advances by its own size, so
 * a 24 pt title under an 11 pt line starts below that line instead of being drawn over it (R5-12).
 */
class Flow {
  page!: PDFPage;
  y = 0;
  private readonly charset: ReadonlySet<number>;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    const boldSet = new Set(bold.getCharacterSet());
    this.charset = new Set(font.getCharacterSet().filter((cp) => boldSet.has(cp)));
  }

  safe(text: string): string {
    return pdfSafe(text, this.charset);
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.page.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: rgb(0.62, 0.1, 0.1) });
    this.page.drawText(BANNER, { x: MARGIN, y: PAGE_H - 15, size: 9, font: this.bold, color: rgb(1, 1, 1) });
    this.page.drawText("Prototype. Not legal advice. Confirm filings with a qualified professional.", {
      x: MARGIN,
      y: 24,
      size: 8,
      font: this.font,
      color: rgb(0.35, 0.35, 0.35),
    });
    this.y = TOP;
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of this.safe(text).split("\n")) {
      let cur = "";
      for (const word of para.split(" ")) {
        const trial = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(trial, size) <= width) {
          cur = trial;
          continue;
        }
        if (cur) out.push(cur);
        cur = "";
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let n = rest.length;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          out.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        cur = rest;
      }
      out.push(cur);
    }
    return out;
  }

  text(text: string, opts: { size?: number; bold?: boolean; indent?: number; color?: [number, number, number]; gap?: number } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const lineH = size * LINE;
    for (const l of this.wrap(text, font, size, PAGE_W - 2 * MARGIN - indent)) {
      if (this.y - lineH < MARGIN + 16) this.newPage();
      const [r, g, b] = opts.color ?? [0.08, 0.08, 0.08];
      this.page.drawText(l, { x: MARGIN + indent, y: this.y - size * ASCENT, size, font, color: rgb(r, g, b) });
      this.y -= lineH;
    }
    this.y -= opts.gap ?? 0;
  }

  heading(text: string): void {
    this.y -= 6;
    this.text(text, { size: 12, bold: true, gap: 2 });
  }
}

const RED: [number, number, number] = [0.7, 0.1, 0.1];

function dated(label: string, v: DatedValue): { line: string; unverified: boolean } {
  const date = v.status === "ok" && v.date ? v.date : v.status === "not_applicable" ? "NOT APPLICABLE" : "UNKNOWN";
  const unverified = v.status !== "unknown" && !v.verified;
  const refs = [...new Set(v.ruleRefs.map((r) => r.path))].join(", ");
  return { line: `${label}: ${date}${unverified ? "  [UNVERIFIED]" : ""}${refs ? `  (rules: ${refs})` : ""}`, unverified };
}

function interestLine(i: StateInterest): { line: string; unverified: boolean; unknown: boolean } {
  if (i.status === "ok") {
    return {
      line: `~${formatUSD(i.cents)} accruing, from the rule file (rules ${i.ruleVersion})${i.verified ? "" : "  [UNVERIFIED]"}`,
      unverified: !i.verified,
      unknown: false,
    };
  }
  if (i.status === "unknown") return { line: `UNKNOWN: ${i.reason}. No rate is assumed.`, unverified: false, unknown: true };
  return { line: "None: nothing in this filing is late.", unverified: false, unknown: false };
}

const sourced = (d: SourcedDate | null): string => (d ? `${fmtDay(d.date)}${d.unverified ? "  [UNVERIFIED]" : ""}` : "UNKNOWN");

/** The filing facts, as on the close-out receipt. Returns how many values it marked UNVERIFIED. */
function filingSection(flow: Flow, filing: EvidenceFiling | null | undefined, asOf: string): number {
  flow.heading("Filing");
  if (!filing) {
    flow.text("Not filed yet. This pack was generated before submission; download it again after filing to include the confirmation.", { indent: 8 });
    return 0;
  }
  let unverified = 0;
  flow.text(`Replica confirmation: ${filing.confirmation ?? "not returned by the portal yet"}`, { bold: true, indent: 8 });
  flow.text(`Portal: ${filing.portal} (replica only; nothing was filed with a real state)`, { indent: 8 });
  flow.text(`Submitted: ${filing.submittedAt ? `${fmtInstant(filing.submittedAt)} (system clock)` : "UNKNOWN"}`, { indent: 8 });
  const approvedAt = filing.approvedAt ? ` on ${fmtInstant(filing.approvedAt)}` : "";
  flow.text(`Approved by: ${filing.approvedBy ?? "UNKNOWN"}${approvedAt}, bound to the file checksum below`, { indent: 8 });
  if (filing.checksum) flow.text(`Approved file sha256: ${filing.checksum}`, { size: 8, indent: 8 });
  if (filing.reportDue?.unverified) unverified++;
  const late = filing.daysLate ? `; filed ${filing.daysLate} days late (as of the demo date, ${fmtDay(asOf)})` : filing.reportDue ? "; on time" : "";
  flow.text(`Report due: ${sourced(filing.reportDue)}${late}`, { indent: 8, color: filing.daysLate || !filing.reportDue ? RED : undefined });
  const int = interestLine(filing.interest);
  if (int.unverified) unverified++;
  flow.text(`Late interest disclosed: ${int.line}`, { indent: 8, color: int.unverified || int.unknown ? RED : undefined });
  if (filing.remitDue?.unverified) unverified++;
  flow.text(`To remit: ${filing.remitDue ? `due ${sourced(filing.remitDue)}` : "due date UNKNOWN"}. Payment happens outside this app.`, { indent: 8 });
  const rem = filing.remittance;
  if (rem) {
    const ref = rem.reference ? `, reference ${rem.reference}` : ", no reference recorded";
    flow.text(`Remittance recorded: ${formatUSD(rem.totalCents)} for ${rem.itemCount} item(s) on ${fmtDay(rem.remittedOn)}${ref}, recorded by ${rem.by}`, { indent: 8, bold: true });
  } else {
    flow.text("Remittance: not recorded yet.", { indent: 8 });
  }
  return unverified;
}

function itemPage(flow: Flow, ev: EvidenceItem, index: number, total: number, code: string | undefined): number {
  let unverified = 0;
  const { item, timeline } = ev;
  flow.newPage();
  flow.text(`Item ${index + 1} of ${total}`, { size: 16, bold: true, gap: 4 });
  flow.text(`Owner: ${[item.ownerName.first, item.ownerName.last].filter(Boolean).join(" ")}`, { bold: true });
  flow.text(`Item id: ${item.id}`);
  flow.text(`Amount: ${formatUSD(item.amountCents)}    Reference: ${item.referenceNumber ?? "n/a"}`);
  flow.text(`Property type: ${item.propertyType}    NAUPA code: ${code ?? "NONE (not filed)"}`);
  flow.text(`Last activity: ${item.lastActivityDate ?? "UNKNOWN"}`);
  flow.text(`Owner address: ${[item.address1, item.city, item.state, item.zip].filter(Boolean).join(", ") || "none on file"}`);

  flow.heading("Timeline (computed by the rules engine, not by a model)");
  if (!timeline) {
    flow.text("No timeline supplied. Dates UNKNOWN.", { color: RED });
  } else {
    flow.text(`Rules: ${timeline.rules.state} version ${timeline.rules.version}`);
    const rows: Array<[string, DatedValue]> = [
      ["Presumed abandoned", timeline.presumedAbandoned],
      ["Due diligence window opens", timeline.ddWindow.start],
      ["Due diligence window closes", timeline.ddWindow.end],
      ...timeline.reportStages.flatMap((s): Array<[string, DatedValue]> => [
        [`Report "${s.name}" as-of`, s.asOf],
        [`Report "${s.name}" due`, s.due],
      ]),
      ["Remit due", timeline.remitDue],
    ];
    for (const [label, v] of rows) {
      const d = dated(label, v);
      if (d.unverified) unverified++;
      flow.text(d.line, { indent: 8, color: d.unverified || v.status === "unknown" ? RED : undefined });
      const urls = [...new Set(v.sources.map((s) => s.url))];
      if (urls.length > 0) flow.text(`sources: ${urls.join("  |  ")}`, { size: 7, indent: 20, color: [0.25, 0.25, 0.45] });
    }
    for (const w of timeline.warnings) flow.text(`Engine warning: ${w}`, { size: 9, indent: 8 });
  }

  flow.heading("Outreach log");
  if (ev.outreach.length === 0) flow.text("No outreach recorded.", { indent: 8 });
  for (const o of ev.outreach) {
    flow.text(`${o.at}  ${o.channel.toUpperCase()}  ${o.status}${o.to ? `  to ${o.to}` : ""}`, { indent: 8, bold: true });
    if (o.summary) flow.text(o.summary, { indent: 20, size: 9 });
    if (o.lobLetterId) flow.text(`Lob TEST letter id: ${o.lobLetterId}`, { indent: 20, size: 9 });
    if (o.lobUrl) flow.text(`Lob preview URL: ${o.lobUrl}`, { indent: 20, size: 9 });
    if (o.emailId) flow.text(`Email id: ${o.emailId}`, { indent: 20, size: 9 });
  }

  flow.heading("Owner responses");
  if (ev.ownerResponses.length === 0) flow.text("No owner response recorded.", { indent: 8 });
  for (const r of ev.ownerResponses) flow.text(`${r.at}  ${r.channel}: ${r.summary}`, { indent: 8 });
  return unverified;
}

function appendix(flow: Flow, ruleFiles: readonly RuleFile[], usedTypes: ReadonlySet<string>, state: string): number {
  let unverified = 0;
  flow.newPage();
  flow.text("Appendix: rule values used", { size: 16, bold: true, gap: 4 });
  flow.text("Every legal value below comes from a versioned rule file and carries its source. Values not yet confirmed by a human are flagged in red.", { size: 9, gap: 4 });
  const files = ruleFiles.filter((r) => r.state === state);
  if (files.length === 0) flow.text(`No rule file supplied for ${state}.`, { color: RED });
  for (const file of files) {
    flow.heading(`${file.state} rules, version ${file.version} (researched ${file.researched_at || "n/a"})`);
    const used = PROPERTY_TYPES.filter((pt) => usedTypes.has(pt));
    const values = used.length > 0 ? used.flatMap((pt) => listRuleValuesFor(file, pt)) : listRuleValues(file);
    const seen = new Set<string>();
    for (const { path, rv } of values) {
      if (seen.has(path)) continue;
      seen.add(path);
      const bad = !rv.verified;
      if (bad) unverified++;
      flow.text(`${path} = ${rv.value === null ? "UNKNOWN (null)" : JSON.stringify(rv.value)}${bad ? "  [UNVERIFIED]" : "  [verified]"}`, {
        size: 9,
        indent: 4,
        bold: bad,
        color: bad ? RED : undefined,
      });
      for (const s of rv.sources) flow.text(`${s.title ? `${s.title}: ` : ""}${s.url}`, { size: 8, indent: 16, color: [0.25, 0.25, 0.45] });
      if (rv.todo) flow.text(`todo: ${rv.todo}`, { size: 8, indent: 16 });
    }
  }
  return unverified;
}

export async function buildEvidencePack(input: EvidencePackInput): Promise<EvidencePack> {
  const { report, items, ruleFiles } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const asOf = input.asOf ?? report.period.end;
  const doc = await PDFDocument.create();
  doc.setTitle(`Evidence pack ${report.state} ${report.period.end}`);
  doc.setCreator("Escheat Agent (prototype)");
  doc.setProducer("Escheat Agent (prototype)");
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  const flow = new Flow(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  const fileSha = createHash("sha256").update(report.file).digest("hex");

  // Cover
  flow.newPage();
  flow.text("Escheat Agent", { size: 11, bold: true });
  flow.text("Filing Evidence Pack", { size: 24, bold: true, gap: 6 });
  flow.text("PROTOTYPE. SYNTHETIC DATA. NOT LEGAL ADVICE.", { size: 12, bold: true, color: RED, gap: 8 });
  flow.text(`Holder: ${report.holder.name}`, { bold: true });
  flow.text(`State: ${report.state}    Stage: ${report.stage.name}${report.stage.includesRemittance ? " (remits funds)" : " (no remittance)"}`);
  flow.text(`Reporting period: ${fmtDay(report.period.start)} to ${fmtDay(report.period.end)}`);
  flow.text(`NAUPA report type: ${report.reportTypeCode}    As of (demo date): ${fmtDay(asOf)}`);
  flow.text(`Generated: ${fmtInstant(generatedAt)} (system clock)`, { size: 8 });
  flow.text(`NAUPA file sha256: ${fileSha}`, { size: 8 });
  const versions = ruleFiles.filter((r) => r.state === report.state).map((r) => `${r.state}@${r.version}`);
  flow.text(`Rule versions: ${versions.join(", ") || "none supplied"}`, { gap: 6 });

  flow.heading("Totals");
  flow.text(`Items in file: ${report.totals.itemCount}    Property records: ${report.totals.propertyRecordCount}`);
  flow.text(`Total reported: ${formatUSD(report.totals.totalCents)}`, { bold: true });
  for (const [code, t] of Object.entries(report.totals.byPropertyCode).sort(([a], [b]) => a.localeCompare(b))) {
    flow.text(`${code}: ${t.count} record(s), ${formatUSD(t.cents)}`, { indent: 8 });
  }
  if (report.excludedItemIds.length > 0) {
    flow.text(`Items left out of the file: ${report.excludedItemIds.length}`, { color: RED });
  }
  flow.text(`Validation: ${report.errors.length === 0 ? "passed" : `${report.errors.length} error(s)`}    Warnings: ${report.warnings.length}`, { gap: 4 });
  for (const e of report.errors.slice(0, 8)) flow.text(`ERROR ${e.field}: ${e.message}`, { size: 8, indent: 8, color: RED });

  let unverified = filingSection(flow, input.filing, asOf);

  // Items
  const usedTypes = new Set(items.map((i) => i.item.propertyType));
  const rulesForState = ruleFiles.find((r) => r.state === report.state);
  items.forEach((ev, i) => {
    const code = rulesForState?.propertyTypes[ev.item.propertyType]?.naupaCode.value ?? undefined;
    unverified += itemPage(flow, ev, i, items.length, code);
  });

  unverified += appendix(flow, ruleFiles, usedTypes, report.state);

  const bytes = await doc.save({ useObjectStreams: false });
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pageCount: doc.getPageCount(),
    unverifiedCount: unverified,
  };
}
