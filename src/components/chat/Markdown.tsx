import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/chat/markdown";
import { cn } from "@/lib/utils";

function renderInline(nodes: Inline[], keyPrefix = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.t) {
      case "text":
        return <Fragment key={key}>{n.v}</Fragment>;
      case "strong":
        return (
          <strong key={key} className="font-semibold text-foreground">
            {renderInline(n.c, `${key}.`)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(n.c, `${key}.`)}</em>;
      case "code":
        return (
          <code key={key} className="rounded-[5px] bg-[var(--chat-ink-3)] px-1 py-px font-mono text-[0.86em] text-foreground">
            {n.v}
          </code>
        );
      case "link":
        return n.external ? (
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="chat-link">
            {renderInline(n.c, `${key}.`)}
            {n.trusted ? null : (
              <span className="ml-1 inline-block text-[0.86em] text-[var(--chat-t3)]" data-link-host>
                ({n.host})
              </span>
            )}
          </a>
        ) : (
          <Link key={key} href={n.href} className="chat-link">
            {renderInline(n.c, `${key}.`)}
          </Link>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return (
        <p key={i} className="whitespace-pre-wrap text-pretty">
          {renderInline(b.c)}
        </p>
      );
    case "h":
      return (
        <p key={i} className={cn("font-semibold text-balance text-foreground", b.level === 1 ? "text-base" : "text-[0.95rem]")}>
          {renderInline(b.c)}
        </p>
      );
    case "ul":
      return (
        <ul key={i} className="space-y-1">
          {b.items.map((item, j) => (
            <li
              key={j}
              className="relative pl-4 text-pretty before:absolute before:top-[0.7em] before:left-1 before:size-1 before:rounded-full before:bg-[var(--chat-t3)]"
            >
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} start={b.start} className="ml-5 list-decimal space-y-1 marker:text-[var(--chat-t3)] marker:tabular-nums">
          {b.items.map((item, j) => (
            <li key={j} className="pl-1 text-pretty">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
    case "pre":
      return (
        <pre key={i} className="overflow-x-auto rounded-lg border border-[var(--chat-line-strong)] bg-black p-3 font-mono text-[12.5px] leading-relaxed">
          {b.v}
        </pre>
      );
  }
}

/** Renders the safe markdown subset. Every string goes through React's escaping; nothing is injected as HTML. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={cn("space-y-3", className)}>{parseMarkdown(text).map(renderBlock)}</div>;
}
