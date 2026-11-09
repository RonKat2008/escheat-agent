"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { ArrowDown, KeyRound, PinOff, Plus, WifiOff } from "lucide-react";
import type { ChatAvailability } from "@/lib/chat/agent";
import { CHAT_LIMITS } from "@/lib/chat/protocol";
import type { UiPayload } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { isCardPrompt } from "@/lib/ask/cards/intent";
import { keylessStarters, noModelPhraseList, startersFor, type AskStarter } from "@/lib/ask/starters";
import { AskHero } from "./AskHero";
import { Composer } from "./Composer";
import { EmptyChat } from "./EmptyChat";
import { followUpsFor, offlineRecovery } from "./followups";
import { PinContext, TurnView, type PinControl } from "./Messages";
import { useChat, type ToolPart, type Turn } from "./use-chat";
import { ChatActionsContext } from "./views/parts";
import { ViewRenderer } from "./views/registry";
import "./chat.css";

/** Pixels from the bottom that still count as "following" the stream. */
const STICK_THRESHOLD_PX = 96;

/** `follows` false (Ask's hero) keeps the view at the top: the headline and composer, not the bottom of the preview. */
function useStickToBottom(dep: unknown, follows = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const followsRef = useRef(follows);
  useEffect(() => {
    followsRef.current = follows;
  }, [follows]);
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
      if (stuck.current && followsRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (stuck.current && follows) toBottom(false);
  }, [dep, toBottom, follows]);

  const follow = useCallback(() => {
    stuck.current = true;
  }, []);

  return { scrollRef, contentRef, atBottom, toBottom, follow };
}

const DEFAULT_CHROME = { top: 96, footer: 64 };

/**
 * Sizes the chat to the space between the shell chrome (top bar, Loop Bar, which differ by breakpoint) and the
 * footer, so the disclaimer footer always stays on screen. Measured, not hardcoded, so chrome changes cannot hide it.
 */
function useChromeHeights(ref: RefObject<HTMLElement | null>) {
  const [chrome, setChrome] = useState(DEFAULT_CHROME);
  useEffect(() => {
    const el = ref.current;
    const footer = document.querySelector<HTMLElement>("#main ~ footer");
    if (!el) return;
    const measure = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      const footerH = footer?.offsetHeight ?? DEFAULT_CHROME.footer;
      setChrome((prev) => (prev.top === top && prev.footer === footerH ? prev : { top, footer: footerH }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    if (footer) ro.observe(footer);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return chrome;
}

function viewsOf(turn: Turn | undefined): UiPayload[] {
  if (!turn || turn.role !== "assistant") return [];
  return turn.parts.flatMap((p) => (p.type === "tool" && p.ui ? [p.ui] : []));
}

const PIN_KEY = "escheat.chat.pin.v1";

/** The tool part a pinned id refers to, if it is still in the conversation. */
export function findPinned(turns: Turn[], id: string | null): ToolPart | null {
  if (!id) return null;
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const p of t.parts) if (p.type === "tool" && p.id === id && p.ui && p.ui.kind !== "error") return p;
  }
  return null;
}

function usePin(turns: Turn[]) {
  // Safe to read during the first render: turns hydrate after mount, so no pinned panel renders before then either way.
  const [pinnedId, setPinnedId] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : sessionStorage.getItem(PIN_KEY);
    } catch {
      return null; // storage blocked: pins last for this page view only
    }
  });
  const set = useCallback((id: string | null) => {
    setPinnedId(id);
    try {
      if (id) sessionStorage.setItem(PIN_KEY, id);
      else sessionStorage.removeItem(PIN_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  const control = useMemo<PinControl>(() => ({ pinnedId, toggle: (id) => set(pinnedId === id ? null : id) }), [pinnedId, set]);
  const clear = useCallback(() => set(null), [set]);
  return { pinned: findPinned(turns, pinnedId), control, clear };
}

function PinnedPanel({ part, onClose }: { part: ToolPart; onClose: () => void }) {
  return (
    <aside aria-label="Pinned view" className="hidden w-[420px] shrink-0 flex-col border-l border-[var(--chat-line)] bg-[var(--chat-ink-0)] xl:flex" data-testid="chat-pinned">
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        <p className="min-w-0 flex-1 truncate text-xs text-[var(--chat-t3)]">
          Pinned <span className="text-[var(--chat-t2)]">{part.label}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="chat-focus inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs text-[var(--chat-t3)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]"
        >
          <PinOff className="size-3.5" strokeWidth={1.5} aria-hidden />
          Unpin
        </button>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">{part.ui ? <ViewRenderer ui={part.ui} /> : null}</div>
    </aside>
  );
}

/**
 * `/chat?ask=...` (e.g. the Reports page's "Plan close-out") prefills the composer once and never sends on its own.
 * `/chat?q=...` (the command palette's "Ask") starts a new conversation with that question and sends it.
 * Both params are removed from the URL right away, so a reload or Back never re-sends.
 */
export function readChatParams(href: string): { ask: string | null; q: string | null; cleaned: string | null } {
  const url = new URL(href);
  const pick = (k: string) => url.searchParams.get(k)?.trim().slice(0, CHAT_LIMITS.maxUserChars) || null;
  const ask = pick("ask");
  const q = pick("q");
  if (!url.searchParams.has("ask") && !url.searchParams.has("q")) return { ask, q, cleaned: null };
  url.searchParams.delete("ask");
  url.searchParams.delete("q");
  return { ask, q, cleaned: `${url.pathname}${url.search}${url.hash}` };
}

function useUrlQuestion(
  hydrated: boolean,
  canSend: (text: string) => boolean,
  setDraft: (text: string) => void,
  startNew: (text: string) => void,
  inputRef: RefObject<HTMLTextAreaElement | null>,
) {
  useEffect(() => {
    if (!hydrated) return;
    const { ask, q, cleaned } = readChatParams(window.location.href);
    if (cleaned === null) return;
    window.history.replaceState(window.history.state, "", cleaned);
    if (q && canSend(q)) startNew(q);
    else if (q || ask) setDraft((q ?? ask)!);
    inputRef.current?.focus();
  }, [hydrated, canSend, setDraft, startNew, inputRef]);
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
            <span className="font-medium text-[var(--chat-t1)]">Offline mode.</span> Chat replays recorded answers. When the data has changed or a question was not
            recorded, common questions are answered directly from your data, labelled, with no model. Anything else says there is no recorded answer.
          </>
        ) : (
          <>
            <span className="font-medium text-[var(--chat-t1)]">Chat needs ANTHROPIC_API_KEY.</span> Add it to <code className="font-mono text-xs">.env.local</code> and restart
            the server. Every other page works without it, and Ask can still set things up with no model: upload a CSV, set up integrations, what&apos;s overdue, or get
            started.
          </>
        )}
      </p>
    </div>
  );
}

interface ChatAppProps {
  availability: ChatAvailability;
  model: string;
  /** "ask": Ask mode's layout (docs/ASK-MODE.md §1.1): AskHero empty state, hero composer, wider column. */
  variant?: "chat" | "ask";
  /** Ask starter chips built from real state (src/lib/ask/starters.ts); filtered here for offline chat. */
  starters?: readonly AskStarter[];
  /** Server-rendered "Where the money is" preview for the Ask empty state. */
  mapPreview?: ReactNode;
}

export function ChatApp({ availability, model, variant = "chat", starters = [], mapPreview = null }: ChatAppProps) {
  const isAsk = variant === "ask";
  const { turns, hydrated, busy, send, startNew, stop, retry, reset } = useChat();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** No model: free questions cannot be sent, but the Ask action cards (deterministic intents) still work. */
  const disabled = availability === "not_configured";
  const canSend = useCallback((text: string) => !disabled || isCardPrompt(text), [disabled]);
  const lastTurn = turns.at(-1);
  const streamTick = lastTurn?.role === "assistant" ? lastTurn.parts.length + (lastTurn.parts.at(-1)?.type === "text" ? 1 : 0) : turns.length;
  const { scrollRef, contentRef, atBottom, toBottom, follow } = useStickToBottom(`${turns.length}:${streamTick}`, !(isAsk && turns.length === 0));
  const rootRef = useRef<HTMLElement>(null);
  const chrome = useChromeHeights(rootRef);
  const pin = usePin(turns);
  const offline = availability === "offline";
  const clearPin = pin.clear;
  const startFresh = useCallback(
    (text: string) => {
      clearPin();
      follow();
      startNew(text);
    },
    [clearPin, startNew, follow],
  );
  useUrlQuestion(hydrated, canSend, setDraft, startFresh, inputRef);

  const ask = useCallback(
    (text: string) => {
      if (!canSend(text)) return;
      follow();
      send(text);
      setDraft("");
      inputRef.current?.focus();
    },
    [canSend, send, follow],
  );

  const actions = useMemo(() => ({ ask, canAsk: !disabled && !busy, canAskPrompt: (q: string) => !busy && canSend(q) }), [ask, disabled, busy, canSend]);

  const followUps = useMemo(() => {
    if (busy || lastTurn?.role !== "assistant" || lastTurn.status !== "done") return [];
    const asked = turns.flatMap((t) => (t.role === "user" ? [t.text] : []));
    return followUpsFor(viewsOf(lastTurn), asked, { offline }).filter(canSend);
  }, [busy, lastTurn, turns, offline, canSend]);

  // Offline dead end (R4-26): nothing recorded continues this conversation, so offer recorded prompts as a new chat.
  const recovery = useMemo(() => {
    if (!offline || busy || turns.length === 0 || followUps.length > 0) return null;
    if (lastTurn?.role !== "assistant" || lastTurn.status === "streaming") return null;
    const asked = turns.flatMap((t) => (t.role === "user" ? [t.text] : []));
    const missed = lastTurn.status === "error" && lastTurn.error?.code === "offline_unavailable";
    const r = offlineRecovery(asked, missed, { direct: !missed && lastTurn.offlineAnswer !== undefined });
    return r.prompts.length ? r : null;
  }, [offline, busy, turns, followUps.length, lastTurn]);

  // Ask renders its hero on the server too (the headline is the page's LCP), so it does not wait for hydration; a
  // restored conversation replaces it right after mount.
  const empty = turns.length === 0 && (hydrated || isAsk);
  const heroComposer = isAsk && empty;
  const shownStarters = useMemo(() => (disabled ? keylessStarters(starters) : startersFor(starters, offline)), [starters, offline, disabled]);

  // The hero composer unmounts with the first message: keep the caret in the docked one.
  const wasHero = useRef(heroComposer);
  useEffect(() => {
    if (wasHero.current && !heroComposer && document.activeElement === document.body) inputRef.current?.focus({ preventScroll: true });
    wasHero.current = heroComposer;
  }, [heroComposer]);

  const composerProps = {
    value: draft,
    onChange: setDraft,
    onSend: () => ask(draft),
    onStop: stop,
    busy,
    // Ask stays typeable without a model so the setup cards are reachable; the classic chat stays disabled.
    disabled: disabled && !isAsk,
    sendable: canSend(draft),
    placeholder: disabled
      ? isAsk
        ? "No model set. Try “get started”, “upload a CSV”, “draft letters” or any card"
        : "Chat is not configured"
      : isAsk
        ? "Ask anything, or ask me to do something"
        : "Ask about exposure, a check, or a rule",
  };
  const noModelHint =
    disabled && isAsk && draft.trim() && !canSend(draft) ? (
      <p role="status" data-testid="chat-no-model-hint" className="mt-2 text-xs text-pretty text-[var(--chat-t3)]">
        Without a model Ask can only open its cards. Try {noModelPhraseList()}.
      </p>
    ) : null;

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <ChatActionsContext value={actions}>
          <PinContext value={pin.control}>
            <section
              ref={rootRef}
              aria-label="Chat"
              className="chat-root -mx-4 -my-6 flex flex-col sm:-mx-6 lg:-my-8 xl:-mx-8"
              style={{ height: `calc(100dvh - ${chrome.top}px - ${chrome.footer}px)` }}
            >
              <header className={cn("flex h-11 shrink-0 items-center gap-3 px-4 sm:px-6", isAsk && empty ? "" : "border-b border-[var(--chat-line)]")}>
                <h2 className="text-[13px] font-medium text-[var(--chat-t1)]">{isAsk ? "Ask" : "Chat"}</h2>
                <span className="truncate text-xs text-[var(--chat-t3)]" data-testid="chat-model">
                  {disabled ? "not configured" : availability === "offline" ? "offline replay" : model}
                </span>
                <span className="flex-1" />
                {turns.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      reset();
                      pin.clear();
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

              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  {/* Focusable so keyboard users can scroll it even when nothing inside is focusable (e.g. chat disabled, narrow screens). */}
                  <div
                    ref={scrollRef}
                    tabIndex={0}
                    role="region"
                    aria-label="Chat"
                    className="chat-scroll chat-focus relative min-h-0 flex-1 overflow-y-auto"
                    data-testid="chat-scroll"
                  >
                    <div
                      ref={contentRef}
                      className={cn("mx-auto flex min-h-full w-full flex-col px-4 pt-6 sm:px-6", isAsk ? (empty ? "max-w-[1168px]" : "max-w-[880px]") : "max-w-[760px]", empty ? "" : "pb-6")}
                    >
                      {empty && isAsk ? (
                        <AskHero
                          starters={shownStarters}
                          onPick={ask}
                          disabled={disabled}
                          canPick={canSend}
                          autoFocus
                          offline={offline}
                          notice={<AvailabilityNotice availability={availability} />}
                          composer={
                            <>
                              <Composer {...composerProps} inputRef={inputRef} size="hero" />
                              {noModelHint}
                            </>
                          }
                          inputRef={inputRef}
                          mapPreview={mapPreview}
                        />
                      ) : empty ? (
                        <EmptyChat onPick={ask} disabled={disabled} offline={offline} />
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
                        <div role="group" className="mt-5 flex flex-wrap gap-2" aria-label="Suggested follow-ups" data-testid="chat-followups">
                          {followUps.map((q) => (
                            <button
                              key={q}
                              type="button"
                              data-testid="chat-followup"
                              onClick={() => ask(q)}
                              className="chat-focus inline-flex min-h-8 items-center rounded-[6px] border border-[var(--chat-line-strong)] px-2.5 py-1 text-left text-[13px] text-[var(--chat-t2)] transition-[border-color,color,transform] duration-150 hover:border-[var(--chat-blue-text)]/50 hover:text-[var(--chat-t1)] active:scale-[0.98]"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {recovery ? (
                        <div className="mt-5" data-testid="chat-recovery">
                          <p className="mb-2 text-xs text-[var(--chat-t3)]" data-testid="chat-recovery-note">
                            {recovery.note}
                          </p>
                          <div role="group" className="flex flex-wrap gap-2" aria-label="Recorded prompts">
                            {recovery.prompts.map((q) => (
                              <button
                                key={q}
                                type="button"
                                data-testid="chat-recovery-chip"
                                onClick={() => startFresh(q)}
                                className="chat-focus inline-flex min-h-8 items-center rounded-[6px] border border-[var(--chat-line-strong)] px-2.5 py-1 text-left text-[13px] text-[var(--chat-t2)] transition-[border-color,color,transform] duration-150 hover:border-[var(--chat-blue-text)]/50 hover:text-[var(--chat-t1)] active:scale-[0.98]"
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Ask's empty state carries its own hero composer; the dock appears with the first message. */}
                  {heroComposer ? null : (
                  <div className={cn("relative shrink-0 px-4 pt-2 pb-3 sm:px-6 sm:pb-4", isAsk && "pb-[max(0.75rem,env(safe-area-inset-bottom))]")}>
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
                    <div className={cn("mx-auto w-full", isAsk ? "max-w-[840px]" : "max-w-[720px]")}>
                      <Composer {...composerProps} inputRef={inputRef} size={isAsk ? "hero" : "default"} />
                      {noModelHint}
                      <p className="mt-2 hidden text-center text-[11px] text-[var(--chat-t3)] sm:block">
                        Answers come from tools, not the model&apos;s memory. Nothing is sent or filed from chat.
                      </p>
                    </div>
                  </div>
                  )}
                </div>
                {pin.pinned ? <PinnedPanel part={pin.pinned} onClose={pin.clear} /> : null}
              </div>
            </section>
          </PinContext>
        </ChatActionsContext>
      </LazyMotion>
    </MotionConfig>
  );
}
