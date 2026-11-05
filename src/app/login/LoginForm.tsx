"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/settings/TechnicalDetails";
import { toOperatorMessage } from "@/lib/settings/operator-copy";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

/** Three cycles of a 2px horizontal shake. Transform only (compositor-friendly). */
const SHAKE_FRAMES: Keyframe[] = [0, -2, 2, -2, 2, -2, 2, 0].map((x) => ({ transform: `translateX(${x}px)` }));
const SHAKE_MS = 360;

/** OS setting or the in-app "Reduce motion" preference (mirrored onto <html data-motion="reduce">). */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  const hasError = Boolean(state.error);
  // R3-14: a config-style error (e.g. a missing passcode setting) reads in plain words; the name sits behind a disclosure.
  const message = state.error ? toOperatorMessage(state.error) : null;
  const inputRef = useRef<HTMLInputElement>(null);
  // The form clears the field after a failed attempt, which drops focus to <body>; put it back so the retry is one keystroke away.
  // Each failed attempt also shakes the field (§6.2: three 2px x-cycles); the border turns pink-500 via aria-invalid.
  useEffect(() => {
    const el = inputRef.current;
    if (!state.error || !el) return;
    el.focus();
    if (prefersReducedMotion() || typeof el.animate !== "function") return;
    const anim = el.animate(SHAKE_FRAMES, { duration: SHAKE_MS, easing: "ease-in-out" });
    return () => anim.cancel();
  }, [state]);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="text-[13px] text-fg-2">
        Passcode
      </label>
      <input
        ref={inputRef}
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        aria-invalid={hasError}
        aria-describedby={hasError ? "passcode-error" : undefined}
        className="h-11 rounded-full border border-line-hover bg-ink-0/60 px-4 font-mono text-sm text-fg-1 outline-none transition-[border-color] duration-150 hover:border-line-strong focus-visible:border-blue-400 aria-invalid:border-pink-500 aria-invalid:focus-visible:border-pink-500"
      />
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-pink-400">
          {message?.plain}
        </p>
      ) : null}
      {message?.technical ? (
        <TechnicalDetails>
          <p className="font-mono text-xs text-fg-1">{message.technical}</p>
        </TechnicalDetails>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-3 h-11 w-full">
        {pending ? "Checking..." : "Enter"}
      </Button>
    </form>
  );
}
