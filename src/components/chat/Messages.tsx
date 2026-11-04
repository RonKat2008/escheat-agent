"use client";

import { createContext, use, useState } from "react";
import { m } from "motion/react";
import { Ban, Check, ChevronRight, CircleAlert, CircleCheck, Copy, Pin, PinOff, RotateCcw, WifiOff } from "lucide-react";
import type { UiKind } from "@/lib/chat/ui-types";
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

/** Views worth keeping beside the conversation. Action cards (approval, clock) stay in the thread, where their state lives. */
const PINNABLE: ReadonlySet<UiKind> = new Set(["exposure", "items", "item_timeline", "deadlines", "interest", "approvals", "rules", "reports", "report", "recoveries", "runs", "agent_run"]);

export interface PinControl {
  pinnedId: string | null;
  toggle: (partId: string) => void;
}
export const PinContext = createContext<PinControl | null>(null);

function PinButton({ partId }: { partId: string }) {
  const pin = use(PinContext);
  if (!pin) return null;
  const pinned = pin.pinnedId === partId;
  const Icon = pinned ? PinOff : Pin;
  return (
    <button
      type="button"
      onClick={() => pin.toggle(partId)}
      aria-pressed={pinned}
      data-testid="chat-pin"
      className="chat-focus -my-1 ml-auto hidden h-7 shrink-0 items-center gap-1 rounded-[6px] px-2 text-xs text-[var(--chat-t3)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)] xl:inline-flex"
    >
      <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
      {pinned ? "Unpin" : "Pin to side"}
    </button>
  );
}

/** Placeholder with the rough shape of a card, so the view lands where the eye already is instead of popping in. */
function ViewSkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-[10px] border border-[var(--chat-line)] bg-[var(--chat-ink-1)]" data-testid="chat-tool-skeleton">
      <div className="flex h-11 items-center gap-2.5 border-b border-[var(--chat-line)] px-4">
        <span className="chat-pulse size-4 rounded bg-[var(--chat-ink-3)]" />
        <span className="chat-pulse h-3 w-40 rounded bg-[var(--chat-ink-3)]" />
      </div>
      <div className="space-y-2.5 px-4 py-4">
        <span className="chat-pulse block h-3 w-3/4 rounded bg-[var(--chat-ink-3)]" />
        <span className="chat-pulse block h-3 w-1/2 rounded bg-[var(--chat-ink-3)]" />
      </div>
    </div>
  );
}

/** The app declined on purpose (a rule said no): not a failure, nobody has to act. */
export const isRefusal = (part: ToolPart): boolean => part.status === "error" && part.ui?.kind === "error" && part.ui.props.refused === true;

/** A tool call: a quiet "working" line over a card-shaped placeholder that resolves into its generative view. */
function ToolBlock({ part }: { part: ToolPart }) {
  const running = part.status === "running";
  const refused = isRefusal(part);
  const failed = part.status === "error" && !refused;
  const showView = part.ui && part.ui.kind !== "error";
  const pinnable = !running && showView && part.ui && PINNABLE.has(part.ui.kind);
  const pinned = use(PinContext)?.pinnedId === part.id;
  return (
    <div className="space-y-2" data-testid="chat-tool" data-tool={part.name} data-status={part.status}>
      <div className="flex min-h-5 items-center gap-1.5 text-xs text-[var(--chat-t3)]">
        <span className="shrink-0" aria-hidden>
          {running ? (
            <span className="grid size-3.5 place-items-center">
              <span className="chat-pulse glow-live block size-2 rounded-full bg-[var(--chat-blue-text)]" />
            </span>
          ) : failed ? (
            <CircleAlert className="size-3.5 text-[var(--chat-pink-text)]" strokeWidth={1.5} />
          ) : refused ? (
            <Ban className="size-3.5 text-[var(--chat-t3)]" strokeWidth={1.5} />
          ) : (
            <CircleCheck className="size-3.5 text-[var(--chat-blue-500)]" strokeWidth={1.5} />
          )}
        </span>
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2" aria-live="polite">
          <span className={cn("shrink-0", running && "chat-pulse")}>{part.label}</span>
          {!running && !refused && part.summary ? <span className="min-w-0 truncate text-[var(--chat-t3)] max-sm:basis-full">{part.summary}</span> : null}
        </p>
        {pinnable ? <PinButton partId={part.id} /> : null}
      </div>
      {running ? <ViewSkeleton /> : null}
      {(failed || refused) && part.ui ? <ViewRenderer ui={part.ui} /> : null}
      {showView && part.ui ? (
        <m.div
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className={cn(pinned && "xl:hidden")}
        >
          <ViewRenderer ui={part.ui} />
        </m.div>
      ) : null}
      {pinned ? (
        <p className="hidden h-11 items-center rounded-[10px] border border-dashed border-[var(--chat-line-strong)] px-4 text-xs text-[var(--chat-t3)] xl:flex">
          Shown in the side panel while pinned.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The agent thread (§6.12): every tool call of this answer in order, collapsed to one line. While a tool runs the line
 * carries the live (blue glow) dot. It stays collapsed by default: the card placeholder below already shows progress.
 */
export function ToolTrace({ tools, streaming }: { tools: ToolPart[]; streaming: boolean }) {
  if (tools.length === 0) return null;
  const running = tools.filter((t) => t.status === "running").length;
  const refused = tools.filter(isRefusal).length;
  const failed = tools.filter((t) => t.status === "error").length - refused;
  const state = running ? "running" : failed ? "error" : refused ? "refused" : "done";
  return (
    <details className="group/trace rounded-[8px] border border-[var(--chat-line)] bg-[var(--chat-ink-1)]/60" data-testid="chat-tool-trace" data-state={state}>
      <summary className="chat-focus flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-[8px] px-2.5 text-xs text-[var(--chat-t3)] select-none hover:text-[var(--chat-t2)] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-open/trace:rotate-90" strokeWidth={1.5} aria-hidden />
        {running ? (
          <span aria-hidden className="chat-pulse glow-live size-1.5 shrink-0 rounded-full bg-[var(--chat-blue-text)]" />
        ) : failed ? (
          <CircleAlert className="size-3.5 shrink-0 text-[var(--chat-pink-text)]" strokeWidth={1.5} aria-hidden />
        ) : refused ? (
          <Ban className="size-3.5 shrink-0 text-[var(--chat-t3)]" strokeWidth={1.5} aria-hidden />
        ) : (
          <CircleCheck className="size-3.5 shrink-0 text-[var(--chat-blue-500)]" strokeWidth={1.5} aria-hidden />
        )}
        <span className="instrument-label !text-[var(--chat-t3)]">Agent thread</span>
        <span className="tabular-nums">
          {tools.length} {tools.length === 1 ? "tool call" : "tool calls"}
          {running
            ? `, ${running} running`
            : streaming
              ? ", writing the answer"
              : [failed ? `${failed} failed` : "", refused ? `${refused} declined by a rule` : ""].filter(Boolean).map((s) => `, ${s}`).join("")}
        </span>
      </summary>
      <ol className="space-y-1.5 border-t border-[var(--chat-line)] px-3 py-2.5" aria-label="Tool calls">
        {tools.map((t, i) => (
          <li key={t.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 text-xs" data-status={t.status}>
            <span className="pt-px text-right text-[var(--chat-t4)] tabular-nums" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="text-[var(--chat-t1)]">{t.label}</span>{" "}
              <code className="font-mono text-[11px] text-[var(--chat-t3)]">{t.name}</code>
              <span className="sr-only">{t.status === "running" ? ", running" : isRefusal(t) ? ", declined by a rule" : t.status === "error" ? ", failed" : ", done"}</span>
              {t.summary ? <span className="block truncate text-[var(--chat-t3)]">{t.summary}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Answers replayed from a recording (ESCHEAT_OFFLINE) say so on the answer itself, not only in the composer. */
export function OfflineReplayBadge() {
  return (
    <span
      data-testid="chat-offline-badge"
      title="Replayed from a recording of the live model. Nothing was generated just now; the cards ran against this app's data."
      className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--chat-line-strong)] px-2 text-[11px] font-medium text-[var(--chat-t2)]"
    >
      <WifiOff className="size-3" strokeWidth={1.75} aria-hidden />
      Offline replay
    </span>
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
          {turn.offline ? "Replaying the recorded answer" : "Thinking"}
        </p>
      ) : null}
      <ToolTrace tools={turn.parts.filter((p): p is ToolPart => p.type === "tool")} streaming={streaming} />
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
      {!streaming && (text || turn.offline || (isLast && canRetry)) ? (
        <div className="-ml-2 flex flex-wrap items-center gap-0.5">
          {text ? <CopyButton text={text} /> : null}
          {isLast && canRetry && turn.status !== "error" ? (
            <button
              type="button"
              onClick={onRetry}
              className="chat-focus inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs text-[var(--chat-t3)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
              Retry
            </button>
          ) : null}
          {turn.offline ? (
            <span className="ml-2">
              <OfflineReplayBadge />
            </span>
          ) : null}
        </div>
      ) : null}
    </m.div>
  );
}

export function TurnView({ turn, isLast, onRetry, canRetry }: { turn: Turn; isLast: boolean; onRetry: () => void; canRetry: boolean }) {
  return turn.role === "user" ? <UserMessage text={turn.text} /> : <AssistantMessage turn={turn} isLast={isLast} onRetry={onRetry} canRetry={canRetry} />;
}
