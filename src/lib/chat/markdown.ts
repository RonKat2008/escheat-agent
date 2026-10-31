/**
 * A tiny, safe markdown subset for assistant replies: paragraphs, headings (#..###), bullet and numbered
 * lists, fenced code, inline code, **bold**, *italic* and [links](url). It produces a plain AST that the
 * client renders as React elements (no HTML strings, no dangerouslySetInnerHTML), so raw HTML in a reply
 * is shown as text. Links are limited to same-app paths and http(s). External links to a rule-file source host
 * render as plain links; any other host renders with its hostname visible next to the text (see link-hosts.ts),
 * so a reply cannot disguise where a link sends the user or what it carries.
 */
import { displayHost, isTrustedSourceHost } from "./link-hosts";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; host: string | null; trusted: boolean; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; v: string };

export interface SafeHref {
  href: string;
  external: boolean;
  /** Hostname shown to the user for external links (null for same-app paths). */
  host: string | null;
  /** Same-app path, or an official source host cited by the rule files. */
  trusted: boolean;
}

/** Returns a normalized href for allowed targets, or null (rendered as plain text). */
export function safeHref(raw: string): SafeHref | null {
  const href = raw.trim();
  // Same-app paths only: no protocol-relative "//host", no backslash tricks.
  if (/^\/(?![/\\])[^\s\\]*$/.test(href)) return { href, external: false, host: null, trusted: true };
  try {
    const u = new URL(href);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null; // "https://sco.ca.gov@evil.example" style disguises
    return { href: u.toString(), external: true, host: displayHost(u.hostname), trusted: isTrustedSourceHost(u.hostname) };
  } catch {
    return null;
  }
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*?\*)|(?<![\p{L}\p{N}_])(_[^_\s][^_\n]*?_)(?![\p{L}\p{N}_])/u;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    const tok = m[0];
    if (m[1]) out.push({ t: "code", v: tok.slice(1, -1) });
    else if (m[2]) out.push({ t: "strong", c: parseInline(tok.slice(2, -2)) });
    else if (m[3]) {
      const close = tok.indexOf("](");
      const label = tok.slice(1, close);
      const target = safeHref(tok.slice(close + 2, -1));
      out.push(target ? { t: "link", ...target, c: parseInline(label) } : { t: "text", v: label });
    } else out.push({ t: "em", c: parseInline(tok.slice(1, -1)) });
    rest = rest.slice(m.index + tok.length);
  }
  // Merge adjacent text nodes.
  return out.reduce<Inline[]>((acc, n) => {
    const last = acc.at(-1);
    if (n.t === "text" && last?.t === "text") return [...acc.slice(0, -1), { t: "text", v: last.v + n.v }];
    return [...acc, n];
  }, []);
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, c: parseInline(h[2]!) });
      continue;
    }
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (b || n) {
      flush();
      const ordered = !b;
      const items: Inline[][] = [];
      const start = n ? Number(n[1]) : 1;
      while (i < lines.length) {
        const cur = lines[i]!;
        const mb = BULLET.exec(cur);
        const mn = NUMBERED.exec(cur);
        const m = ordered ? mn : mb;
        if (m) items.push(parseInline(ordered ? mn![2]! : mb![1]!));
        else if (cur.trim() && /^\s{2,}/.test(cur) && items.length) {
          items[items.length - 1] = parseInline(`${inlineText(items.at(-1)!)} ${cur.trim()}`);
        } else break;
        i++;
      }
      i--;
      blocks.push(ordered ? { t: "ol", start, items } : { t: "ul", items });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Plain text of an inline run (used for list continuation lines and copy). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c))).join("");
}
