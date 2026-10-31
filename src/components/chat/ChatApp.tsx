"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { ArrowDown, CornerDownLeft, KeyRound, Plus, WifiOff } from "lucide-react";
import type { ChatAvailability } from "@/lib/chat/agent";
import type { UiPayload } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { EXAMPLE_PROMPTS, followUpsFor } from "./followups";
import { TurnView } from "./Messages";
import { useChat, type Turn } from "./use-chat";
import { ChatActionsContext } from "./views/parts";
import "./chat.css";

/** Pixels from the bottom that still count as "following" the stream. */
const STICK_THRESHOLD_PX = 96;

function useStickToBottom(dep: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const toBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
    stuck.current = true;
    setAtBottom(true);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Content growth must never unstick: only a scroll that moves UP (the user's intent) releases the lock.
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      if (near) stuck.current = true;
      else if (el.scrollTop < lastTop - 2) stuck.current = false;
      lastTop = el.scrollTop;
      setAtBottom(near || stuck.current);
    };
    // Any upward intent by the user releases the lock immediately, even mid-stream.
    const release = (e: WheelEvent) => {
      if (e.deltaY < 0) stuck.current = false;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", release);
    };
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el) return;
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (stuck.current) toBottom(false);
  }, [dep, toBottom]);

  const follow = useCallback(() => {
    stuck.current = true;
  }, []);

  return { scrollRef, contentRef, atBottom, toBottom, follow };
}

/** The app footer holds the disclaimer; size the chat so the footer stays on screen. */
function useFooterHeight() {
  const [h, setH] = useState(64);
  useEffect(() => {
    const footer = document.querySelector<HTMLElement>("#main ~ footer");
    if (!footer) return;
    const ro = new ResizeObserver(() => setH(footer.offsetHeight));
    ro.observe(footer);
    return () => ro.disconnect();
  }, []);
  return h;
}

function viewsOf(turn: Turn | undefined): UiPayload[] {
  if (!turn || turn.role !== "assistant") return [];
  return turn.parts.flatMap((p) => (p.type === "tool" && p.ui ? [p.ui] : []));
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-end pb-6 sm:justify-center sm:pb-10" data-testid="chat-empty">
      <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-balance text-[var(--chat-t1)] sm:text-[28px]">Ask about your unclaimed property</h1>
      <p className="mt-2 max-w-[56ch] text-sm text-pretty text-[var(--chat-t2)]">
        Answers come from the same records as the rest of the app. Anything that would go out to a person or a state is only drafted here, and waits for you in Approvals.
      </p>
      <ul className="mt-6 divide-y divide-[var(--chat-line)] border-y border-[var(--chat-line)]" aria-label="Example questions">
        {EXAMPLE_PROMPTS.map((q) => (
          <li key={q}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(q)}
              data-testid="chat-example"
              className="chat-focus group flex min-h-11 w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-[15px] text-[var(--chat-t2)] transition-colors duration-150 hover:text-[var(--chat-t1)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            >
              <span>{q}</span>
              <CornerDownLeft
                className="size-3.5 shrink-0 text-[var(--chat-t4)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                strokeWidth={1.5}
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AvailabilityNotice({ availability }: { availability: ChatAvailability }) {
  if (availability === "ready") return null;
  const offline = availability === "offline";
  const Icon = offline ? WifiOff : KeyRound;
  return (
    <div
      role="status"
      data-testid={offline ? "chat-offline" : "chat-not-configured"}
      className="mx-auto mb-3 flex w-full max-w-[720px] items-start gap-2.5 rounded-[10px] border border-[var(--chat-line)] bg-[var(--chat-ink-1)] px-3.5 py-3 text-[13px]"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-[var(--chat-t3)]" strokeWidth={1.5} aria-hidden />
      <p className="text-pretty text-[var(--chat-t2)]">
        {offline ? (
          <>
            <span className="font-medium text-[var(--chat-t1)]">Offline mode.</span> Chat replays recorded answers only. A question without a recording says so instead of
            answering.
          </>
        ) : (
          <>
            <span className="font-medium text-[var(--chat-t1)]">Chat needs ANTHROPIC_API_KEY.</span> Add it to <code className="font-mono text-xs">.env.local</code> and restart
            the server. Every other page works without it.
          </>
        )}
      </p>
    </div>
  );
}

export function ChatApp({ availability, model }: { availability: ChatAvailability; model: string }) {
  const { turns, hydrated, busy, send, stop, retry, reset } = useChat();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const disabled = availability === "not_configured";
  const lastTurn = turns.at(-1);
  const streamTick = lastTurn?.role === "assistant" ? lastTurn.parts.length + (lastTurn.parts.at(-1)?.type === "text" ? 1 : 0) : turns.length;
  const { scrollRef, contentRef, atBottom, toBottom, follow } = useStickToBottom(`${turns.length}:${streamTick}`);
  const footerH = useFooterHeight();

  const ask = useCallback(
    (text: string) => {
      if (disabled) return;
      follow();
      send(text);
      setDraft("");
      inputRef.current?.focus();
    },
    [disabled, send, follow],
  );

  const actions = useMemo(() => ({ ask, canAsk: !disabled && !busy }), [ask, disabled, busy]);

  const followUps = useMemo(() => {
    if (busy || lastTurn?.role !== "assistant" || lastTurn.status !== "done") return [];
    const asked = turns.flatMap((t) => (t.role === "user" ? [t.text] : []));
    return followUpsFor(viewsOf(lastTurn), asked);
  }, [busy, lastTurn, turns]);

  const empty = hydrated && turns.length === 0;

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <ChatActionsContext value={actions}>
          <section
            aria-label="Chat"
            className="chat-root -mx-4 -my-6 flex flex-col sm:-mx-6 lg:-my-8 xl:-mx-8"
            style={{ height: `calc(100dvh - 3.5rem - ${footerH}px)` }}
          >
            <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--chat-line)] px-4 sm:px-6">
              <h2 className="text-[13px] font-medium text-[var(--chat-t1)]">Chat</h2>
              <span className="truncate text-xs text-[var(--chat-t3)]" data-testid="chat-model">
                {disabled ? "not configured" : availability === "offline" ? "offline replay" : model}
              </span>
              <span className="flex-1" />
              {turns.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setDraft("");
                    inputRef.current?.focus();
                  }}
                  className="chat-focus inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-[var(--chat-t2)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
                >
                  <Plus className="size-4" strokeWidth={1.5} aria-hidden />
                  New chat
                </button>
              ) : null}
            </header>

            <div ref={scrollRef} className="chat-scroll relative min-h-0 flex-1 overflow-y-auto" data-testid="chat-scroll">
              <div ref={contentRef} className={cn("mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 pt-6 sm:px-6", empty ? "" : "pb-6")}>
                {empty ? (
                  <EmptyState onPick={ask} disabled={disabled} />
                ) : (
                  <ol className="space-y-7" aria-label="Conversation" aria-live="off">
                    {turns.map((t, i) => (
                      <li key={t.id}>
                        <TurnView turn={t} isLast={i === turns.length - 1} onRetry={retry} canRetry={!busy && !disabled} />
                      </li>
                    ))}
                  </ol>
                )}
                {followUps.length ? (
                  <div className="mt-5 flex flex-wrap gap-2" aria-label="Suggested follow-ups" data-testid="chat-followups">
                    {followUps.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => ask(q)}
                        className="chat-focus inline-flex min-h-8 items-center rounded-[6px] border border-[var(--chat-line-strong)] px-2.5 py-1 text-left text-[13px] text-[var(--chat-t2)] transition-[border-color,color,transform] duration-150 hover:border-[var(--chat-blue-text)]/50 hover:text-[var(--chat-t1)] active:scale-[0.98]"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative shrink-0 px-4 pt-2 pb-3 sm:px-6 sm:pb-4">
              {!atBottom && !empty ? (
                <button
                  type="button"
                  onClick={() => toBottom(true)}
                  className="chat-focus absolute -top-11 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--chat-line-strong)] bg-[var(--chat-ink-2)] px-3 text-xs text-[var(--chat-t1)] shadow-[0_8px_24px_rgb(0_0_0/0.5)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)]"
                >
                  <ArrowDown className="size-3.5" strokeWidth={1.5} aria-hidden />
                  Jump to latest
                </button>
              ) : null}
              <AvailabilityNotice availability={availability} />
              <div className="mx-auto w-full max-w-[720px]">
                <Composer
                  value={draft}
                  onChange={setDraft}
                  onSend={() => ask(draft)}
                  onStop={stop}
                  busy={busy}
                  disabled={disabled}
                  inputRef={inputRef}
                  placeholder={disabled ? "Chat is not configured" : "Ask about exposure, a check, or a rule"}
                />
                <p className="mt-2 hidden text-center text-[11px] text-[var(--chat-t3)] sm:block">
                  Answers come from tools, not the model&apos;s memory. Nothing is sent or filed from chat.
                </p>
              </div>
            </div>
          </section>
        </ChatActionsContext>
      </LazyMotion>
    </MotionConfig>
  );
}
