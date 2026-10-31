import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/chat/Markdown";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("markdown subset", () => {
  it("parses bold, italic, code, lists, headings and fenced code", () => {
    const blocks = parseMarkdown("## Total\nYou owe **$61,915.00** in *three* states.\n\n- CA `21`\n- TX 15\n\n1. one\n2. two\n\n```\nraw <b>\n```");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "pre"]);
    expect(parseInline("**a** and *b* and `c`").map((n) => n.t)).toEqual(["strong", "text", "em", "text", "code"]);
  });

  it("escapes raw HTML instead of rendering it", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="alert(2)"> **<b>bold</b>**');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("<strong");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("only allows http(s) and same-app links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/approvals")).toEqual({ href: "/approvals", external: false, host: null, trusted: true });
    expect(safeHref("https://www.sco.ca.gov/upd.html")?.external).toBe(true);
    const out = html("[click](javascript:alert(1)) and [ok](/items?item=10482) and [src](https://example.gov/x)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="/items?item=10482"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("keeps an unterminated stream chunk readable", () => {
    expect(html("You owe **$61,9")).toContain("**$61,9");
  });

  it("leaves underscores inside identifiers alone but still reads _emphasis_", () => {
    expect(parseInline("set OWNER_LINK_SECRET and ANTHROPIC_API_KEY")).toEqual([{ t: "text", v: "set OWNER_LINK_SECRET and ANTHROPIC_API_KEY" }]);
    expect(parseInline("a _real_ one")).toEqual([{ t: "text", v: "a " }, { t: "em", c: [{ t: "text", v: "real" }] }, { t: "text", v: " one" }]);
  });

  it("shows the hostname next to any external link that is not a rule-file source (L1)", () => {
    expect(safeHref("https://www.sco.ca.gov/upd.html")).toMatchObject({ external: true, host: "sco.ca.gov", trusted: true });
    expect(safeHref("https://evil.example/c?d=ssn-123")).toMatchObject({ external: true, host: "evil.example", trusted: false });
    expect(safeHref("https://sco.ca.gov@evil.example/")).toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
    const out = html("[Rule source](https://leginfo.legislature.ca.gov/x) and [Approvals](/approvals) and [your report](https://evil.example/c?d=1)");
    expect(out).toContain('href="/approvals"');
    expect(out).toContain("(evil.example)");
    expect(out).not.toContain("(leginfo.legislature.ca.gov)");
    expect(out).toContain('referrerPolicy="no-referrer"');
  });
});
