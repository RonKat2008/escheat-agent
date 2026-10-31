"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="text-xs font-medium text-muted-foreground">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? "passcode-error" : undefined}
        className="h-10 rounded-lg border border-input bg-sunken px-3 font-mono text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-bolt focus-visible:ring-3 focus-visible:ring-bolt/30"
      />
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-lg bg-bolt px-4 text-sm font-semibold text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_6px_16px_-8px_var(--es-bolt-glow)] transition-[background-color,transform] duration-150 hover:bg-bolt-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-bolt focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
      >
        {pending ? "Checking..." : "Enter"}
      </button>
    </form>
  );
}
