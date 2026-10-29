import { DISCLAIMER } from "@/lib/disclaimer";
import { formatUSD } from "@/lib/money";

/** Visible marker inserted when a state's required notice language is not known. Never invent statutory text. */
export const UNKNOWN_LANGUAGE_MARKER = "[Required state language UNKNOWN — rule TODO]";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    // Lob treats {{ }} as merge-variable syntax; never let data open one.
    .replace(/\{\{/g, "{&#8203;{")
    .replace(/\}\}/g, "}&#8203;}");
}

export interface LetterRenderInput {
  holderName: string;
  holderAddressLines: string[];
  ownerName: string;
  ownerAddressLines: string[];
  dateLabel: string;
  /** Statutory text from the rule file (verbatim), or null when unknown. */
  requiredLanguage: string | null;
  /** Rule file's own TODO note, shown under the UNKNOWN placeholder. */
  requiredLanguageTodo?: string | null;
  greeting: string;
  itemDescription: string;
  responseInstructions: string;
  itemRows: { label: string; value: string }[];
  responseUrl: string;
  variablesSource: "model" | "template";
}

const LETTER_CSS = `
@page { size: 8.5in 11in; margin: 0.75in; }
html, body { margin: 0; padding: 0; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; color: #111; }
.page { width: 7in; }
.holder { font-size: 10pt; color: #333; margin-bottom: 18pt; }
.holder strong { font-size: 12pt; color: #111; }
.statutory { border: 2px solid #111; padding: 10pt 12pt; margin: 0 0 16pt; font-weight: bold; font-size: 11.5pt; text-transform: none; }
.statutory.unknown { border: 2px dashed #b00020; color: #b00020; }
.statutory .todo { display: block; font-weight: normal; font-size: 9pt; margin-top: 6pt; color: #333; }
.date { margin: 0 0 12pt; }
.recipient { margin: 0 0 14pt; }
table.item { border-collapse: collapse; margin: 10pt 0 14pt; width: 100%; }
table.item th, table.item td { text-align: left; padding: 3pt 8pt 3pt 0; border-bottom: 1px solid #ccc; font-size: 10.5pt; vertical-align: top; }
table.item th { width: 32%; font-weight: normal; color: #444; }
.respond { border: 1px solid #111; padding: 8pt 10pt; margin: 12pt 0; font-size: 10.5pt; }
.respond .url { word-break: break-all; font-family: 'Courier New', monospace; font-size: 10pt; }
.foot { margin-top: 18pt; font-size: 8.5pt; color: #444; border-top: 1px solid #999; padding-top: 6pt; }
`;

const lines = (xs: string[]) => xs.map((x) => escapeHtml(x)).join("<br>");

/** Pure: render a print-friendly, Lob-compatible letter. All dynamic text is HTML-escaped. */
export function renderLetterHtml(i: LetterRenderInput): string {
  const statutory =
    i.requiredLanguage !== null
      ? `<div class="statutory" data-statutory="true">${escapeHtml(i.requiredLanguage)}</div>`
      : `<div class="statutory unknown" data-statutory="unknown">${escapeHtml(UNKNOWN_LANGUAGE_MARKER)}${
          i.requiredLanguageTodo ? `<span class="todo">Rule note: ${escapeHtml(i.requiredLanguageTodo)}</span>` : ""
        }</div>`;
  const rows = i.itemRows
    .map((r) => `<tr><th scope="row">${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Notice to ${escapeHtml(i.ownerName)}</title>
<style>${LETTER_CSS}</style></head>
<body data-variables-source="${i.variablesSource}">
<!-- variables_source: ${i.variablesSource} -->
<div class="page">
${statutory}
<div class="holder"><strong>${escapeHtml(i.holderName)}</strong><br>${lines(i.holderAddressLines)}</div>
<p class="date">${escapeHtml(i.dateLabel)}</p>
<p class="recipient">${escapeHtml(i.ownerName)}<br>${lines(i.ownerAddressLines)}</p>
<p>${escapeHtml(i.greeting)}</p>
<p>${escapeHtml(i.itemDescription)}</p>
<table class="item"><tbody>${rows}</tbody></table>
<p>${escapeHtml(i.responseInstructions)}</p>
<div class="respond">Respond online (confirm your address, or tell us the item was already paid):<br>
<span class="url">${escapeHtml(i.responseUrl)}</span></div>
<p>Questions? Contact ${escapeHtml(i.holderName)}${i.holderAddressLines.length ? ` at ${escapeHtml(i.holderAddressLines.join(", "))}` : ""}.</p>
<div class="foot">SYNTHETIC TEST MAIL - Lob test mode, nothing is mailed. ${escapeHtml(DISCLAIMER)}</div>
</div>
</body></html>`;
}

/** Wrap stored HTML for in-app preview: banner above the content, never part of what is mailed. */
export function withPreviewBanner(html: string, banner: string): string {
  const bar = `<div style="position:sticky;top:0;z-index:9;background:#fff3cd;color:#5c4400;border-bottom:2px solid #b8860b;padding:8px 12px;font:600 13px/1.3 system-ui,sans-serif">${escapeHtml(banner)}</div>`;
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => `${m}${bar}`) : `${bar}${html}`;
}

export const money = (cents: number) => formatUSD(cents);
