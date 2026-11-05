/**
 * Audit binder PDF: a cover page (sample, seed, readiness score and the open actions, with a rules gap listed once), then exactly one page per sampled item, each with the prototype banner, the sample's seed and demo date,
 * and the item's nine proof links with their evidence, sources (title + URL), UNVERIFIED markers and the gate that fixes
 * a missing link. Built in memory and returned; nothing is written to disk or to the database.
 *
 * Shares BANNER / pdfSafe / fmtDay with the evidence pack (src/lib/reports/evidence-pack.ts) so the two read alike.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatUSD } from "@/lib/money";
import { BANNER, fmtDay, pdfSafe } from "@/lib/reports/evidence-pack";
import { STATUS_LABELS, type LinkStatus, type ProofLink } from "./proof-chain";
import type { Readiness } from "./score";

export interface BinderItem {
  id: string;
  payeeName: string;
  amountCents: number;
  status: string;
  referenceNumber: string | null;
  chain: ProofLink[];
  score: Readiness;
}

export interface BinderInput {
  state: string;
  today: string;
  seed: string;
  populationCount: number;
  all: boolean;
  ruleVersion: string | null;
  score: Readiness;
  items: BinderItem[];
  /** The company's audit chain verification at build time (src/lib/audit/chain-db.ts). Omitted: section not drawn. */
  chain?: BinderChain;
}

export interface BinderChain {
  ok: boolean;
  length: number;
  headHash: string;
  firstBrokenSeq?: number;
  reason?: string;
}

/** The "Audit chain" lines on the cover: result, length, full head hash. */
export function chainLines(c: BinderChain): { heading: string; detail: string; head: string } {
  return {
    heading: c.ok ? `Audit chain verified: ${c.length} ${c.length === 1 ? "event" : "events"}` : `Audit chain broken at #${c.firstBrokenSeq ?? "?"} (${c.length} rows stored)`,
    detail: c.ok
      ? "Every stored event (clock moves, approvals, sent letters, reports, remittances, rule approvals, recovery claims) was recomputed in order: each row's sha256 matches its contents and points at the row before it."
      : `${c.reason ?? "A row does not match its hash."} Rows after it cannot be relied on as recorded.`,
    head: `Head sha256 ${c.headHash}`,
  };
}

export const BINDER_DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const BOTTOM = 44;
const TEXT_W = PAGE_W - MARGIN * 2;

type Rgb = ReturnType<typeof rgb>;
const INK = rgb(0.08, 0.08, 0.1);
const MUTED = rgb(0.38, 0.38, 0.42);
const BLUE = rgb(0.15, 0.3, 0.85);
const PINK = rgb(0.78, 0.12, 0.45);

const STATUS_COLOR: Record<LinkStatus, Rgb> = { proven: BLUE, missing: PINK, rules_gap: PINK, not_yet_due: MUTED, not_required: MUTED };

const pct = (s: Readiness) => (s.pct === null ? "n/a" : `${s.pct}%`);

class Page {
  y = PAGE_H - 46;
  private readonly charset: ReadonlySet<number>;
  constructor(
    readonly page: PDFPage,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    const boldSet = new Set(bold.getCharacterSet());
    this.charset = new Set(font.getCharacterSet().filter((cp) => boldSet.has(cp)));
    page.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: rgb(0.62, 0.1, 0.1) });
    page.drawText(BANNER, { x: MARGIN, y: PAGE_H - 15, size: 9, font: bold, color: rgb(1, 1, 1) });
    page.drawText(BINDER_DISCLAIMER, { x: MARGIN, y: 22, size: 8, font, color: MUTED });
  }

  get full(): boolean {
    return this.y < BOTTOM;
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    let cur = "";
    for (const word of pdfSafe(text, this.charset).replace(/\n/g, " ").split(" ")) {
      const trial = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) {
        cur = trial;
        continue;
      }
      if (cur) out.push(cur);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      cur = rest;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Draws wrapped text; stops (with an ellipsis) instead of spilling onto a second page. */
  text(text: string, o: { size?: number; bold?: boolean; x?: number; color?: Rgb; gap?: number; maxLines?: number } = {}): void {
    const size = o.size ?? 9;
    const font = o.bold ? this.bold : this.font;
    const x = MARGIN + (o.x ?? 0);
    const lines = this.wrap(text, font, size, TEXT_W - (o.x ?? 0)).slice(0, o.maxLines ?? 4);
    for (const line of lines) {
      if (this.full) return;
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.32;
    }
    this.y -= o.gap ?? 0;
  }

  /** "LABEL ........ STATUS" on one line. */
  row(left: string, right: string, color: Rgb): void {
    if (this.full) return;
    const size = 10;
    const l = pdfSafe(left, this.charset);
    const r = pdfSafe(right, this.charset);
    this.page.drawText(l, { x: MARGIN, y: this.y - size, size, font: this.bold, color: INK });
    const w = this.bold.widthOfTextAtSize(r, 8);
    this.page.drawText(r, { x: PAGE_W - MARGIN - w, y: this.y - size, size: 8, font: this.bold, color });
    this.y -= size * 1.4;
  }

  rule(): void {
    if (this.full) return;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.5, color: rgb(0.82, 0.82, 0.86) });
    this.y -= 6;
  }
}

/** Open actions for the cover: each missing link kind with its item count, and a state-wide rules gap ONCE. */
export function openActions(input: BinderInput): string[] {
  const out: string[] = [];
  if (input.score.rulesGaps > 0) {
    out.push(`1 action: verify the ${input.state} rules${input.ruleVersion ? ` (${input.state} ${input.ruleVersion})` : ""}. The rule file is on file but its values are UNVERIFIED; this is one state-wide rules gap, not a missing record on each item.`);
  }
  const byLabel = new Map<string, number>();
  for (const item of input.items) for (const l of item.chain) if (l.status === "missing") byLabel.set(l.label, (byLabel.get(l.label) ?? 0) + 1);
  for (const [label, n] of byLabel) out.push(`${n} ${n === 1 ? "item" : "items"}: ${label} is missing.`);
  return out;
}

function drawCover(p: Page, input: BinderInput): void {
  const sample = input.all ? `all ${input.populationCount} items` : `${input.items.length} of ${input.populationCount} items`;
  p.text(`AUDIT BINDER  |  ${input.state}  |  COVER`, { size: 8, bold: true, color: MUTED, gap: 6 });
  p.text(`${input.state} audit request: ${sample}`, { size: 18, bold: true, gap: 8 });
  p.text(`Demo date ${fmtDay(input.today)}. Seed sha256 ${input.seed}. Rules ${input.ruleVersion ?? "UNKNOWN"}.`, { size: 9, color: MUTED, gap: 8, maxLines: 3 });
  const s = input.score;
  p.rule();
  p.text(`Readiness ${pct(s)}`, { size: 14, bold: true, color: s.pct === 100 ? BLUE : PINK });
  p.text(`${s.proven} of ${s.required} links due today are proven. ${s.missing} missing records, ${s.rulesGaps} rules gap, ${s.notYetDue} not yet due, ${s.notRequired} not required.`, { size: 9, gap: 8, maxLines: 3 });
  p.text("Open actions", { size: 11, bold: true });
  const actions = openActions(input);
  if (actions.length === 0) p.text("None. Every required link that is due is proven.", { size: 9 });
  actions.forEach((a, i) => p.text(`${i + 1}. ${a}`, { size: 9, maxLines: 4 }));
  if (input.chain) drawChain(p, input.chain);
  p.y -= 8;
  p.text("Each following page is one sampled item with its nine proof links, sources and the gate that fixes anything open.", { size: 8, color: MUTED, maxLines: 3 });
}

function drawChain(p: Page, c: BinderChain): void {
  const l = chainLines(c);
  p.y -= 6;
  p.rule();
  p.text(l.heading, { size: 11, bold: true, color: c.ok ? BLUE : INK });
  p.text(l.detail, { size: 8, color: MUTED, maxLines: 3 });
  p.text(l.head, { size: 7, color: MUTED, gap: 4 });
}

function drawItem(p: Page, input: BinderInput, item: BinderItem, index: number): void {
  const sample = input.all ? `all ${input.populationCount} items` : `${input.items.length} of ${input.populationCount} items`;
  p.text(`AUDIT BINDER  |  ${input.state}  |  ITEM ${index + 1} OF ${input.items.length}`, { size: 8, bold: true, color: MUTED });
  p.text(`Demo date ${fmtDay(input.today)}. Sample: ${sample}, seed sha256 ${input.seed.slice(0, 16)}. Rules ${input.ruleVersion ?? "UNKNOWN"}. Sample readiness ${pct(input.score)}.`, {
    size: 8,
    color: MUTED,
    gap: 6,
  });
  p.text(item.payeeName, { size: 15, bold: true });
  p.text(
    `${item.referenceNumber ? `Ref ${item.referenceNumber}  |  ` : ""}${formatUSD(item.amountCents)}  |  status ${item.status.replace(/_/g, " ")}  |  item readiness ${pct(item.score)} (${item.score.proven} of ${item.score.required} due links proven${item.score.rulesGapNote ? "; the state-wide rules gap is on the cover, not scored per item" : ""})`,
    { size: 9, color: MUTED, gap: 4 },
  );
  p.text(`Item id ${item.id}`, { size: 7, color: MUTED, gap: 6 });
  p.rule();
  item.chain.forEach((l, i) => {
    p.row(`${i + 1}. ${l.label}`, `${STATUS_LABELS[l.status].toUpperCase()}${l.unverified ? "  |  UNVERIFIED" : ""}`, STATUS_COLOR[l.status]);
    p.text(l.evidence, { x: 12, size: 9, maxLines: 3 });
    if (l.detail.length) p.text(l.detail.join("  |  "), { x: 12, size: 8, color: MUTED, maxLines: 2 });
    for (const s of l.sources) p.text(`Source: ${s.title}  ${s.url}`, { x: 12, size: 7, color: BLUE, maxLines: 2 });
    if (l.fix) p.text(`Fix: ${l.fix.label} (${l.fix.href})`, { x: 12, size: 8, color: PINK });
    p.y -= 4;
  });
}

/** A cover page plus one page per item. An empty sample yields one page saying so, so the download is never a broken file. */
export async function buildAuditBinder(input: BinderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Audit binder ${input.state} ${input.today}`);
  doc.setSubject("Synthetic data. Prototype. Not legal advice.");
  doc.setProducer("Escheat Agent prototype");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (input.items.length === 0) {
    const p = new Page(doc.addPage([PAGE_W, PAGE_H]), font, bold);
    p.text(`AUDIT BINDER  |  ${input.state}`, { size: 8, bold: true, color: MUTED });
    p.text(`No ${input.state} items to sample on ${fmtDay(input.today)}.`, { size: 14, bold: true });
    if (input.chain) drawChain(p, input.chain);
    return doc.save();
  }
  drawCover(new Page(doc.addPage([PAGE_W, PAGE_H]), font, bold), input);
  input.items.forEach((item, i) => drawItem(new Page(doc.addPage([PAGE_W, PAGE_H]), font, bold), input, item, i));
  return doc.save();
}
