"use client";

import { useState } from "react";
import { m } from "motion/react";
import { Check, CircleAlert, CircleCheck, Copy, LoaderCircle, RotateCcw } from "lucide-react";
import type { AssistantTurn, Part, ToolPart, Turn } from "./use-chat";
import { assistantText } from "./use-chat";
import { Markdown } from "./Markdown";
import { ViewRenderer } from "./views/registry";
import { cn } from "@/lib/utils";

const ENTER = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.24, ease: [0.25, 1, 0.5, 1] as const } };

export function UserMessage({ text }: { text: string }) {
  return (
    <m.div {...ENTER} className="flex justify-end" data-testid="chat-user-message">
      <p className="max-w-[85%] rounded-[10px] bg-[var(--chat-ink-3)] px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--chat-t1)] sm:max-w-[75%] sm:text-sm">
        {text}
      </p>
    </m.div>
  );
}

/** A tool call: a quiet "working" line that resolves into its generative view. */
function ToolBlock({ part }: { part: ToolPart }) {
  const running = part.status === "running";
  const failed = part.status === "error";
  const showView = part.ui && part.ui.kind !== "error";
  return (
    <div className="space-y-2" data-testid="chat-tool" data-tool={part.name} data-status={part.status}>
      <p className="flex items-center gap-1.5 text-xs text-[var(--chat-t3)]" aria-live="polite">
        {running ? (
          <LoaderCircle className="chat-spinner size-3.5 text-[var(--chat-blue-500)]" strokeWidth={1.5} aria-hidden />
        ) : failed ? (
          <CircleAlert className="size-3.5 text-[var(--chat-pink-text)]" strokeWidth={1.5} aria-hidden />
        ) : (
          <CircleCheck className="size-3.5 text-[var(--chat-blue-500)]" strokeWidth={1.5} aria-hidden />
        )}
        <span className={cn(running && "chat-pulse")}>{part.label}</span>
        {!running && part.summary ? <span className="ml-1 truncate text-[var(--chat-t3)]/70">{part.summary}</span> : null}
      </p>
      {failed && part.ui ? <ViewRenderer ui={part.ui} /> : null}
      {showView && part.ui ? (
        <m.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}>
          <ViewRenderer ui={part.ui} />
        </m.div>
      ) : null}
    </div>
  );
}

function PartView({ part, streaming, isLast }: { part: Part; streaming: boolean; isLast: boolean }) {
  if (part.type === "tool") return <ToolBlock part={part} />;
  return (
    <div className="text-[15px] leading-[1.6] text-[var(--chat-t2)] sm:text-sm [&_strong]:text-[var(--chat-t1)]">
      <Markdown text={part.text} />
      {streaming && isLast ? <span className="chat-caret" aria-hidden /> : null}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy answer"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="chat-focus inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs text-[var(--chat-t3)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
    >
      {copied ? <Check className="size-3.5 text-[var(--chat-blue-500)]" strokeWidth={1.5} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.5} aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function AssistantMessage({ turn, isLast, onRetry, canRetry }: { turn: AssistantTurn; isLast: boolean; onRetry: () => void; canRetry: boolean }) {
  const streaming = turn.status === "streaming";
  const text = assistantText(turn);
  const empty = turn.parts.length === 0;
  return (
    <m.div {...ENTER} className="space-y-4" data-testid="chat-assistant-message" data-status={turn.status}>
      {empty && streaming ? (
        <p className="flex items-center gap-2 text-xs text-[var(--chat-t3)]">
          <span className="chat-pulse size-1.5 rounded-full bg-[var(--chat-blue-500)]" aria-hidden />
          Thinking
        </p>
      ) : null}
      {turn.parts.map((p, i) => (
        <PartView key={p.type === "tool" ? p.id : `t${i}`} part={p} streaming={streaming} isLast={i === turn.parts.length - 1} />
      ))}
      {turn.error && turn.status === "error" ? (
        <div role="alert" data-testid="chat-error" className="flex flex-wrap items-start gap-2 rounded-[10px] border border-[var(--chat-pink)] bg-[var(--chat-pink-900)] px-3 py-2.5 text-[13px] text-[var(--chat-t1)]">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--chat-pink-text)]" strokeWidth={1.5} aria-hidden />
          <span className="min-w-0 flex-1 text-pretty">{turn.error.message}</span>
          {isLast && canRetry ? (
            <button type="button" onClick={onRetry} className="chat-focus -my-0.5 inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs text-[var(--chat-t1)] hover:bg-black/30">
              <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {turn.status === "stopped" ? <p className="text-xs text-[var(--chat-t3)]">Stopped. Nothing after this point ran.</p> : null}
      {!streaming && (text || (isLast && canRetry)) ? (
        <div className="-ml-2 flex items-center gap-0.5">
          {text ? <CopyButton text={text} /> : null}
          {isLast && canRetry && turn.status !== "error" ? (
            <button
              type="button"
              onClick={onRetry}
              aria-label="Ask again"
              className="chat-focus inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs text-[var(--chat-t3)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </m.div>
  );
}

export function TurnView({ turn, isLast, onRetry, canRetry }: { turn: Turn; isLast: boolean; onRetry: () => void; canRetry: boolean }) {
  return turn.role === "user" ? <UserMessage text={turn.text} /> : <AssistantMessage turn={turn} isLast={isLast} onRetry={onRetry} canRetry={canRetry} />;
}
