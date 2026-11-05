/**
 * CFO brief: ONE US-Letter page a finance lead can forward to a CFO or audit committee. Print-friendly: black text on
 * white, electric-blue accents, pink only where a person must act or money is late. Every figure is a CfoBriefData
 * field (./data.ts), which is a query result; this file only lays them out. Built in memory, nothing is written.
 */
import { NOT_COVERED_COPY, notCoveredLine } from "@/lib/coverage";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { DEADLINE_LABEL } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { fmtDay, pdfSafe } from "@/lib/reports/evidence-pack";
import type { CfoBriefData } from "./data";

export const CFO_BRIEF_DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
export const CFO_BRIEF_TITLE = "CFO brief: unclaimed property";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const W = PAGE_W - M * 2;

type Rgb = ReturnType<typeof rgb>;
const INK = rgb(0.06, 0.06, 0.08);
const MUTED = rgb(0.36, 0.36, 0.4);
const HAIR = rgb(0.82, 0.83, 0.87);
const BLUE = rgb(0.11, 0.33, 0.96);
const BLUE_TINT = rgb(0.86, 0.9, 1);
const PINK = rgb(0.8, 0.1, 0.45);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** "2026-11" -> "Nov 2026" (a two-digit year reads as a day of the month). */
export const monthShort = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

/** "2026-11-04T17:03:09.000Z" -> "2026-11-04 17:03 UTC". */
export function stampUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: Rgb;
}

class Canvas {
  private readonly charset: ReadonlySet<number>;
  constructor(
    readonly page: PDFPage,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    const b = new Set(bold.getCharacterSet());
    this.charset = new Set(font.getCharacterSet().filter((cp) => b.has(cp)));
  }

  safe(s: string): string {
    return pdfSafe(s, this.charset).replace(/\n/g, " ");
  }

  width(s: string, o: TextOpts = {}): number {
    return (o.bold ? this.bold : this.font).widthOfTextAtSize(this.safe(s), o.size ?? 9);
  }

  /** One run of text with its baseline at y. Returns the x after it. */
  text(s: string, x: number, y: number, o: TextOpts = {}): number {
    const font = o.bold ? this.bold : this.font;
    const size = o.size ?? 9;
    const t = this.safe(s);
    this.page.drawText(t, { x, y, size, font, color: o.color ?? INK });
    return x + font.widthOfTextAtSize(t, size);
  }

  right(s: string, xRight: number, y: number, o: TextOpts = {}): void {
    this.text(s, xRight - this.width(s, o), y, o);
  }

  /** Word-wrapped paragraph; returns the y below the last line. */
  para(s: string, x: number, y: number, width: number, o: TextOpts & { maxLines?: number } = {}): number {
    const size = o.size ?? 9;
    const lines: string[] = [];
    let cur = "";
    for (const word of this.safe(s).split(" ")) {
      const trial = cur ? `${cur} ${word}` : word;
      if (this.width(trial, o) <= width || !cur) cur = trial;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    let yy = y;
    for (const line of lines.slice(0, o.maxLines ?? 3)) {
      this.text(line, x, yy, o);
      yy -= size * 1.35;
    }
    return yy;
  }

  rule(y: number, x = M, w = W, color: Rgb = HAIR, thickness = 0.5): void {
    this.page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
  }

  label(s: string, x: number, y: number, color: Rgb = MUTED): void {
    this.text(s.toUpperCase(), x, y, { size: 7, bold: true, color });
  }
}

function header(c: Canvas, d: CfoBriefData): number {
  c.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: BLUE });
  let y = PAGE_H - 34;
  c.label(`${CFO_BRIEF_TITLE}  |  synthetic data`, M, y, BLUE);
  c.right(`Demo date ${fmtDay(d.asOf)}`, PAGE_W - M, y, { size: 8, color: MUTED });
  y -= 22;
  c.text(d.company, M, y, { size: 16, bold: true });
  y -= 10;
  c.rule(y);
  return y - 18;
}

function headline(c: Canvas, d: CfoBriefData, y: number): number {
  const h = d.headline;
  c.label("Outstanding, not yet filed", M, y);
  y -= 34;
  c.text(formatUSD(h.cents), M, y, { size: 32, bold: true });
  const nc = h.notCovered;
  const states = h.states.length ? h.states.join(", ") : "no states";
  const scope =
    nc.count > 0
      ? `${plural(h.inScopeStates.length, "state")} we file in (${h.inScopeStates.join(", ")})`
      : `${plural(h.states.length, "state")} (${states})`;
  y -= 16;
  y = c.para(
    `${plural(h.count, "stale item")} not yet reported, across ${scope}, as of ${fmtDay(d.asOf)}.` +
      (h.reportedCount > 0 ? ` Plus ${plural(h.reportedCount, "item")} reported, ${formatUSD(h.reportedCents)} still to remit.` : "") +
      (h.anyUnverified ? " Some of these dates rest on UNVERIFIED rule values." : ""),
    M,
    y,
    W * 0.62,
    { size: 9, color: MUTED },
  );
  if (nc.count > 0) {
    // R9-03: same line and copy as the dashboard, Items, Forecast, Ledger and chat.
    y = c.para(`${notCoveredLine(nc)}. ${NOT_COVERED_COPY} Included in the total above.`, M, y - 4, W * 0.62, { size: 8.5, color: MUTED });
  }
  return y - 6;
}

/** Ledger closing liability, to the right of the headline (ties to /ledger, FY period). */
function ledgerBox(c: Canvas, d: CfoBriefData, top: number): void {
  const x = M + W * 0.66;
  const w = W * 0.34;
  c.page.drawRectangle({ x, y: top - 66, width: w, height: 74, color: BLUE_TINT });
  c.label("Ledger closing liability, FY", x + 10, top - 6, BLUE);
  c.text(formatUSD(d.ledger.closingCents), x + 10, top - 30, { size: 18, bold: true });
  c.para(`${fmtDay(d.ledger.periodStart)} to ${fmtDay(d.ledger.periodEnd)}. ${d.ledger.reconciles ? "Roll-forward ties." : "Roll-forward does NOT tie."} Same figure as /ledger.`, x + 10, top - 44, w - 20, {
    size: 7,
    color: MUTED,
  });
}

const COLS = [
  { key: "State", x: 0, align: "l" },
  { key: "Items", x: 70, align: "r" },
  { key: "Amount", x: 165, align: "r" },
  { key: "Next deadline", x: 185, align: "l" },
  { key: "Days left", x: 380, align: "r" },
  { key: "Rules", x: 395, align: "l" },
] as const;

function stateTable(c: Canvas, d: CfoBriefData, y: number): number {
  c.label("By state", M, y);
  y -= 14;
  for (const col of COLS) {
    if (col.align === "r") c.right(col.key, M + col.x, y, { size: 7.5, bold: true, color: MUTED });
    else c.text(col.key, M + col.x, y, { size: 7.5, bold: true, color: MUTED });
  }
  y -= 5;
  c.rule(y);
  for (const s of d.states) {
    y -= 14;
    c.text(s.state, M, y, { size: 10, bold: true });
    c.right(String(s.count), M + COLS[1].x, y, { size: 9.5 });
    c.right(formatUSD(s.cents), M + COLS[2].x, y, { size: 9.5, bold: true });
    const nd = s.nextDeadline;
    c.text(nd ? `${DEADLINE_LABEL[nd.kind] ?? nd.kind}, ${fmtDay(nd.date)}` : s.datesUnknown > 0 ? `Date unknown for ${plural(s.datesUnknown, "item")}` : "None scheduled", M + COLS[3].x, y, { size: 9, color: nd ? INK : MUTED });
    c.right(nd ? `${nd.daysLeft}d` : "n/a", M + COLS[4].x, y, { size: 9.5, bold: Boolean(nd), color: nd && nd.daysLeft <= 7 ? PINK : INK });
    const after = c.text(s.ruleVersion ?? "No rule file", M + COLS[5].x, y, { size: 8.5, color: MUTED });
    if (s.unverified) c.text("UNVERIFIED", after + 6, y, { size: 7.5, bold: true, color: INK });
    y -= 5;
    c.rule(y);
  }
  return y - 18;
}

function lateSection(c: Canvas, d: CfoBriefData, y: number): number {
  const l = d.late;
  const tone = l.lateCount > 0 ? PINK : MUTED;
  c.label("Late and accruing interest", M, y, tone);
  y -= 18;
  if (l.lateCount === 0) {
    c.text("Nothing is past a report, remittance or due-diligence deadline.", M, y, { size: 10 });
    return y - 20;
  }
  const x = c.text(formatUSD(l.lateCents), M, y, { size: 15, bold: true, color: PINK });
  c.text(` late across ${plural(l.lateCount, "item")}`, x, y, { size: 10 });
  y -= 15;
  let interest: string;
  if (l.interestCents !== null) {
    interest = `About ${formatUSD(l.interestCents)} audit interest accruing (${l.interestStates.join(", ")}), from the sourced interest rule${l.interestVerified ? "." : "; that rule value is UNVERIFIED."}`;
  } else {
    interest = "Audit interest accruing: unknown.";
  }
  if (l.unknownInterestStates.length > 0) {
    interest += ` ${l.interestCents !== null ? "Not counted: " : ""}${l.unknownInterestStates.join(", ")} ${l.unknownInterestStates.length === 1 ? "has" : "have"} no usable interest rule, so no rate is assumed.`;
  }
  y = c.para(interest, M, y, W, { size: 9 });
  if (d.overdue.unknownCount > 0) y = c.para(`${plural(d.overdue.unknownCount, "item")} with a date unknown, not counted as late.`, M, y, W, { size: 8, color: MUTED });
  return y - 10;
}

function waitingAndRecoveries(c: Canvas, d: CfoBriefData, y: number): number {
  const colW = (W - 24) / 2;
  const w = d.waiting;
  const top = y;
  c.label("Waiting on a human", M, y, w.total > 0 ? PINK : MUTED);
  y -= 22;
  const x = c.text(String(w.total), M, y, { size: 20, bold: true, color: w.total > 0 ? PINK : INK });
  c.text(w.total === 1 ? " item waiting on a person" : " items waiting on a person", x, y, { size: 9 });
  const kinds: [string, number][] = [
    ["Letters to approve or send", w.outreach.count],
    ["Reports to sign off", w.reports.count],
    ["Recovery claims", w.recoveries.count],
    ["Rule changes to review", w.ruleChanges],
    ["Owner replies to act on", w.ownerTasks.count],
  ];
  for (const [label, n] of kinds) {
    y -= 12.5;
    c.text(label, M, y, { size: 8.5, color: MUTED });
    c.right(String(n), M + colW, y, { size: 8.5, bold: true, color: n > 0 ? PINK : INK });
  }

  const rx = M + colW + 24;
  let ry = top;
  const r = d.recoveries;
  c.label("Recoveries: money owed back", rx, ry, BLUE);
  ry -= 22;
  const ax = c.text(formatUSD(r.foundCents), rx, ry, { size: 20, bold: true, color: BLUE });
  c.text(` found, ${plural(r.foundCount, "claim")}`, ax, ry, { size: 9 });
  ry -= 14;
  ry = c.para(
    r.foundCount === 0
      ? "Nothing found yet on the CA, DE and TX replica portals."
      : `${formatUSD(r.paidCents)} paid back so far (${plural(r.paidCount, "claim")}). Every claim needs a person's approval before it is filed.`,
    rx,
    ry,
    colW,
    { size: 8.5, color: MUTED },
  );
  return Math.min(y, ry) - 18;
}

function forecastBars(c: Canvas, d: CfoBriefData, y: number): number {
  const f = d.forecast;
  c.label(`Next ${f.months.length} months: becoming presumed abandoned`, M, y);
  c.right(`${formatUSD(f.totalCents)} total, same as /forecast`, PAGE_W - M, y, { size: 7.5, color: MUTED });
  y -= 10;
  const chartH = 54;
  const base = y - chartH - 4;
  const max = Math.max(1, ...f.months.map((m) => m.cents));
  const slot = W / Math.max(1, f.months.length);
  const barW = Math.min(46, slot * 0.5);
  f.months.forEach((m, i) => {
    const cx = M + slot * i + slot / 2;
    const h = m.cents > 0 ? Math.max(1.5, (m.cents / max) * chartH) : 0;
    if (h > 0) c.page.drawRectangle({ x: cx - barW / 2, y: base, width: barW, height: h, color: BLUE });
    const amt = m.cents > 0 ? formatUSD(m.cents) : "$0";
    c.text(amt, cx - c.width(amt, { size: 7 }) / 2, base + h + 3, { size: 7, color: m.cents > 0 ? INK : MUTED });
    const lbl = `${monthShort(m.month)}${m.unverified ? "*" : ""}`;
    c.text(lbl, cx - c.width(lbl, { size: 7.5 }) / 2, base - 10, { size: 7.5, color: MUTED });
  });
  c.rule(base, M, W, HAIR, 0.75);
  y = base - 22;
  if (f.months.some((m) => m.unverified)) y = c.para("* includes dates that rest on UNVERIFIED rule values.", M, y, W, { size: 7, color: MUTED }) - 2;
  return y;
}

function footer(c: Canvas, d: CfoBriefData): void {
  let y = 70;
  c.rule(y + 10);
  c.text(CFO_BRIEF_DISCLAIMER, M, y, { size: 8.5, bold: true });
  y -= 12;
  c.text(`Synthetic data. Generated ${stampUtc(d.generatedAt)}. Demo date ${fmtDay(d.asOf)}.`, M, y, { size: 7.5, color: MUTED });
  y -= 11;
  const rules = d.ruleVersions.length
    ? d.ruleVersions.map((r) => `${r.state} ${r.version}${r.unverified ? " (UNVERIFIED)" : ""}`).join("  |  ")
    : "no rule files loaded";
  c.para(`Rule versions used: ${rules}`, M, y, W, { size: 7.5, color: MUTED, maxLines: 2 });
  y -= 22;
  c.text("Escheat Agent prototype. Figures are query results from the live app state; nothing here is a legal determination.", M, y, { size: 6.5, color: MUTED });
}

/** Exactly one page. */
export async function buildCfoBrief(d: CfoBriefData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${CFO_BRIEF_TITLE} ${d.asOf}`);
  doc.setSubject("Synthetic data. Prototype. Not legal advice.");
  doc.setProducer("Escheat Agent prototype");
  doc.setCreationDate(new Date(d.generatedAt));
  const c = new Canvas(doc.addPage([PAGE_W, PAGE_H]), await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  let y = header(c, d);
  ledgerBox(c, d, y + 4);
  y = headline(c, d, y);
  y = stateTable(c, d, y - 4);
  y = lateSection(c, d, y);
  y = waitingAndRecoveries(c, d, y);
  forecastBars(c, d, y);
  footer(c, d);
  return doc.save();
}
