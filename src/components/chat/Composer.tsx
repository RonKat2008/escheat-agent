"use client";

import { useLayoutEffect, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { CHAT_LIMITS } from "@/lib/chat/protocol";
import { cn } from "@/lib/utils";

const MAX_TEXTAREA_PX = 200;

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** "hero": Ask's large glass pill (56px, docs/ASK-MODE.md §1.1). "default": the docked chat composer. */
  size?: "default" | "hero";
}

const FORM_CLASS = {
  default: "rounded-[10px] bg-[var(--chat-ink-2)] p-2 pl-3.5",
  hero: "glass-strong min-h-14 rounded-[28px] p-2 pl-5",
} as const;
const BUTTON_SHAPE = { default: "size-9 rounded-[6px]", hero: "size-10 rounded-full" } as const;

/** Enter sends, Shift+Enter is a newline, IME composition is respected, and no global shortcut is intercepted. */
export function Composer({ value, onChange, onSend, onStop, busy, disabled, placeholder, inputRef, size = "default" }: ComposerProps) {

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value, inputRef]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!busy && value.trim()) onSend();
  }

  const canSend = !disabled && !busy && value.trim().length > 0;
  const near = value.length > CHAT_LIMITS.maxUserChars * 0.9;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      className={cn("chat-composer flex items-end gap-2", FORM_CLASS[size], disabled && "opacity-60")} data-size={size}
    >
      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-input"
        ref={inputRef}
        data-testid="chat-input"
        rows={1}
        value={value}
        disabled={disabled}
        maxLength={CHAT_LIMITS.maxUserChars}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] leading-[1.45] text-[var(--chat-t1)] outline-none focus-visible:outline-none placeholder:text-[var(--chat-t3)] disabled:cursor-not-allowed sm:text-sm"
      />
      {near ? (
        <span className="self-center text-xs text-[var(--chat-t3)] tabular-nums" aria-live="polite">
          {CHAT_LIMITS.maxUserChars - value.length}
        </span>
      ) : null}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          data-testid="chat-stop"
          aria-label="Stop generating"
          className={cn("chat-focus grid shrink-0 place-items-center border", BUTTON_SHAPE[size], "border-[var(--chat-line-strong)] text-[var(--chat-t1)] transition-[background-color,transform] duration-150 hover:bg-[var(--chat-ink-3)] active:scale-[0.98]")}
        >
          <Square className="size-3.5 fill-current" strokeWidth={1.5} aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          data-testid="chat-send"
          aria-label="Send message"
          className={cn("chat-focus grid shrink-0 place-items-center", BUTTON_SHAPE[size], "bg-[var(--chat-cta)] text-[var(--chat-cta-fg)] transition-[background-color,opacity,transform] duration-150 hover:bg-[var(--chat-cta-hover)] active:scale-[0.98] disabled:bg-[var(--chat-ink-3)] disabled:text-[var(--chat-t4)]")}
        >
          <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
        </button>
      )}
    </form>
  );
}
