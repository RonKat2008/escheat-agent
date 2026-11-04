import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";

function contentBytes(page: PDFPage): Uint8Array[] {
  const ctx = page.doc.context;
  const contents = page.node.lookup(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? contents.asArray() : [page.node.get(PDFName.of("Contents"))];
  const out: Uint8Array[] = [];
  for (const r of refs) {
    const s = ctx.lookup(r);
    if (s instanceof PDFRawStream) out.push(decodePDFRawStream(s).decode());
  }
  return out;
}

/** WinAnsiEncoding's 0x80-0x9F block (the rest of the byte range matches Latin-1). */
const WIN_ANSI_HIGH: Readonly<Record<number, string>> = {
  0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e", 0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6",
  0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152", 0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c",
  0x94: "\u201d", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014", 0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a",
  0x9c: "\u0153", 0x9e: "\u017e", 0x9f: "\u0178",
};

/** Decodes a standard-font (WinAnsi) hex string the way a PDF viewer shows it. */
function winAnsi(hex: string): string {
  return [...Buffer.from(hex, "hex")].map((b) => WIN_ANSI_HIGH[b] ?? String.fromCharCode(b)).join("");
}

/** Visible text per page (pdf-lib writes standard-font text as WinAnsi hex strings). */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) =>
    contentBytes(p)
      .map((c) => Buffer.from(c).toString("latin1"))
      .join("\n")
      .split("\n")
      .map((line) => [...line.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => winAnsi(m[1]!)).join(""))
      .filter(Boolean)
      .join("\n"),
  );
}

/** One drawn text run: its font size, baseline position and text. */
export interface PdfTextRun {
  size: number;
  x: number;
  y: number;
  text: string;
}

const RUN_RE = /\/\S+\s+([\d.]+)\s+Tf|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9A-Fa-f]*)>\s*Tj/g;

/** Text runs per page in drawing order, with the size (Tf) and baseline (Tm) pdf-lib wrote for each. */
export async function pdfTextRuns(bytes: Uint8Array): Promise<PdfTextRun[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const src = contentBytes(p)
      .map((c) => Buffer.from(c).toString("latin1"))
      .join("\n");
    const runs: PdfTextRun[] = [];
    let size = 0;
    let x = 0;
    let y = 0;
    for (const m of src.matchAll(RUN_RE)) {
      if (m[1] !== undefined) size = Number(m[1]);
      else if (m[7] !== undefined) {
        x = Number(m[6]);
        y = Number(m[7]);
      } else if (m[8] !== undefined) runs.push({ size, x, y, text: winAnsi(m[8]) });
    }
    return runs;
  });
}
