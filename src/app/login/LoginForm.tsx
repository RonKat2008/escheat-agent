"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  const hasError = Boolean(state.error);
  const inputRef = useRef<HTMLInputElement>(null);
  // The form clears the field after a failed attempt, which drops focus to <body>; put it back so the retry is one keystroke away.
  useEffect(() => {
    if (state.error) inputRef.current?.focus();
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
        className="h-10 rounded-md border border-line-hover bg-ink-0 px-3 font-mono text-sm text-fg-1 outline-none transition-[border-color] duration-150 hover:border-line-strong focus-visible:border-blue-400 aria-invalid:border-pink-500"
      />
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-pink-400">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-3 w-full">
        {pending ? "Checking..." : "Enter"}
      </Button>
    </form>
  );
}
