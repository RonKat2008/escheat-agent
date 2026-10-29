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

/** Visible text per page (pdf-lib writes standard-font text as hex strings; all text here is printable ASCII). */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) =>
    contentBytes(p)
      .map((c) => Buffer.from(c).toString("latin1"))
      .join("\n")
      .split("\n")
      .map((line) => [...line.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join(""))
      .filter(Boolean)
      .join("\n"),
  );
}
