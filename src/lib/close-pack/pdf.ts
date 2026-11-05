/**
 * Close-pack PDFs in the CFO brief's style (US Letter, black ink, electric-blue accents; pink only where a figure does
 * not tie and a person must look): the roll-forward and the tie-out page. Every figure is passed in; nothing is computed
 * here. Built in memory with pdf-lib.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { Roll } from "@/lib/ledger/rollforward";
import { formatUSD } from "@/lib/money";
import { fmtDay, pdfSafe } from "@/lib/reports/evidence-pack";
import type { TieLine } from "./tieout";

export const CLOSE_PACK_DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
export const CLOSE_PACK_SYNTHETIC = "Synthetic data";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const W = PAGE_W - M * 2;
const BOTTOM = 56;
const INK = rgb(0.06, 0.06, 0.08);
const MUTED = rgb(0.36, 0.36, 0.4);
const HAIR = rgb(0.82, 0.83, 0.87);
const BLUE = rgb(0.11, 0.33, 0.96);
const PINK = rgb(0.8, 0.1, 0.45);

type Rgb = ReturnType<typeof rgb>;
interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: Rgb;
}

class Doc {
  private page!: PDFPage;
  y = 0;
  private constructor(
    readonly pdf: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly charset: ReadonlySet<number>,
    private readonly title: string,
    private readonly demoDate: string,
  ) {
    this.newPage();
  }

  static async create(title: string, demoDate: string): Promise<Doc> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${title} (synthetic data)`);
    pdf.setSubject("Synthetic data. Prototype. Not legal advice.");
    pdf.setProducer("Escheat Agent prototype");
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const b = new Set(bold.getCharacterSet());
    return new Doc(pdf, font, bold, new Set(font.getCharacterSet().filter((cp) => b.has(cp))), title, demoDate);
  }

  private safe(s: string): string {
    return pdfSafe(s, this.charset).replace(/\n/g, " ");
  }

  width(s: string, o: TextOpts = {}): number {
    return (o.bold ? this.bold : this.font).widthOfTextAtSize(this.safe(s), o.size ?? 9);
  }

  text(s: string, x: number, y: number, o: TextOpts = {}): void {
    this.page.drawText(this.safe(s), { x, y, size: o.size ?? 9, font: o.bold ? this.bold : this.font, color: o.color ?? INK });
  }

  right(s: string, xRight: number, y: number, o: TextOpts = {}): void {
    this.text(s, xRight - this.width(s, o), y, o);
  }

  private newPage(): void {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: BLUE });
    this.text(`${this.title.toUpperCase()}  |  ${CLOSE_PACK_SYNTHETIC.toLowerCase()}`, M, PAGE_H - 34, { size: 7, bold: true, color: BLUE });
    this.right(`Demo date ${fmtDay(this.demoDate)}`, PAGE_W - M, PAGE_H - 34, { size: 8, color: MUTED });
    this.rule(PAGE_H - 44);
    this.text(`${CLOSE_PACK_DISCLAIMER}  ${CLOSE_PACK_SYNTHETIC}.`, M, 28, { size: 7.5, color: MUTED });
    this.y = PAGE_H - 66;
  }

  rule(y: number): void {
    this.page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: HAIR });
  }

  ensure(h: number): void {
    if (this.y - h < BOTTOM) this.newPage();
  }

  heading(s: string, size = 16): void {
    this.ensure(size + 12);
    this.text(s, M, this.y, { size, bold: true });
    this.y -= size + 8;
  }

  label(s: string): void {
    this.ensure(22);
    this.y -= 8;
    this.text(s.toUpperCase(), M, this.y, { size: 7, bold: true, color: MUTED });
    this.y -= 6;
    this.rule(this.y);
    this.y -= 14;
  }

  /** Word-wrapped paragraph from x, `width` wide. */
  para(s: string, o: TextOpts & { x?: number; width?: number } = {}): void {
    const size = o.size ?? 9;
    const x = o.x ?? M;
    const width = o.width ?? W - (x - M);
    const words = this.safe(s).split(" ");
    let cur = "";
    const lines: string[] = [];
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (this.width(trial, o) <= width || !cur) cur = trial;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    for (const line of lines) {
      this.ensure(size * 1.4);
      this.text(line, x, this.y, o);
      this.y -= size * 1.4;
    }
  }

  /** A vector check mark (Helvetica has no check glyph). */
  check(x: number, y: number): void {
    this.page.drawLine({ start: { x, y: y + 3 }, end: { x: x + 3, y }, thickness: 1.4, color: BLUE });
    this.page.drawLine({ start: { x: x + 3, y }, end: { x: x + 9, y: y + 8 }, thickness: 1.4, color: BLUE });
  }

  /** Tab-less table row: first cell left, the rest right-aligned at the given right edges. */
  row(cells: readonly string[], rights: readonly number[], o: TextOpts = {}): void {
    this.ensure(14);
    this.text(cells[0] ?? "", M, this.y, o);
    cells.slice(1).forEach((c, i) => this.right(c, rights[i]!, this.y, o));
    this.y -= 14;
  }

  tieLine(l: TieLine): void {
    const size = 8.5;
    const x = M + 18;
    const text = l.status === "tie" ? `${l.label}  (${l.detail})` : l.status === "no_tie" ? `${l.label}  -  does not tie: ${l.detail}` : `${l.label}  -  ${l.detail}`;
    const before = this.y;
    this.ensure(size * 1.4 + 2);
    if (l.status === "tie") this.check(M + 2, this.y - 1);
    else this.text(l.status === "no_tie" ? "x" : "-", M + 3, this.y, { size: 9, bold: true, color: l.status === "no_tie" ? PINK : MUTED });
    this.para(text, { x, size, color: l.status === "no_tie" ? PINK : INK, bold: l.status === "no_tie" });
    this.y -= before === this.y ? 0 : 2;
  }

  save(): Promise<Uint8Array> {
    return this.pdf.save();
  }
}

export interface RollPdfInput {
  periodLabel: string;
  start: string;
  end: string;
  demoDate: string;
  states: readonly Roll[];
  total: Roll;
}

const ROLL_LINES: readonly { key: keyof Pick<Roll, "opening" | "identified" | "resolved" | "clearedLate" | "remitted" | "closing">; label: string; sign: string }[] = [
  { key: "opening", label: "Opening balance", sign: "" },
  { key: "identified", label: "+ Identified (went stale)", sign: "+" },
  { key: "resolved", label: "- Resolved with owner", sign: "-" },
  { key: "clearedLate", label: "- Cleared late by bank", sign: "-" },
  { key: "remitted", label: "- Remitted to the state", sign: "-" },
  { key: "closing", label: "= Closing balance", sign: "" },
];

export async function buildRollForwardPdf(input: RollPdfInput): Promise<Uint8Array> {
  const d = await Doc.create("Liability roll-forward", input.demoDate);
  d.heading(`Unclaimed property payable, ${input.periodLabel}`);
  d.para(`${fmtDay(input.start)} to ${fmtDay(input.end)}. Integer cents, per owner state and in total. Same figures as /ledger.`, { color: MUTED });
  d.y -= 6;
  const cols = [...input.states, input.total];
  const colW = Math.min(90, (W - 150) / cols.length);
  const rights = cols.map((_, i) => PAGE_W - M - (cols.length - 1 - i) * colW);
  d.row(["", ...cols.map((c) => c.state)], rights, { bold: true, size: 8, color: MUTED });
  for (const l of ROLL_LINES) {
    d.row([l.label, ...cols.map((c) => formatUSD(c[l.key]))], rights, { bold: l.key === "opening" || l.key === "closing" });
  }
  d.row(["Ties to item balances", ...cols.map((c) => (c.reconciles ? "ties" : "does not tie"))], rights, { size: 8, color: MUTED });
  return d.save();
}

export interface TieOutPdfInput {
  periodLabel: string;
  demoDate: string;
  lines: readonly TieLine[];
}

export async function buildTieOutPdf(input: TieOutPdfInput): Promise<Uint8Array> {
  const d = await Doc.create("Close pack tie-out", input.demoDate);
  d.heading(`Tie-out, ${input.periodLabel}`);
  const bad = input.lines.filter((l) => l.status === "no_tie").length;
  const na = input.lines.filter((l) => l.status === "n/a").length;
  d.para(
    bad === 0 && na === 0
      ? `All ${input.lines.length} checks tie.`
      : `${input.lines.length - bad - na} of ${input.lines.length} checks tie; ${bad} do not tie; ${na} not available.`,
    { bold: true, color: bad > 0 ? PINK : BLUE },
  );
  d.para("Reconciles the pack's own files to each other. A line is shown as it computes; nothing is forced to tie. The tie-out and manifest cannot list their own hashes; the manifest lists every other file.", { color: MUTED, size: 8 });
  for (const section of ["Journal", "Roll-forward", "Activity", "Audit chain", "Files"] as const) {
    const ls = input.lines.filter((l) => l.section === section);
    if (ls.length === 0) continue;
    d.label(section);
    ls.forEach((l) => d.tieLine(l));
  }
  return d.save();
}
