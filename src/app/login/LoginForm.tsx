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
        className="h-10 rounded-lg border border-input bg-sunken px-3 font-mono text-sm outline-none transition-[border-color] duration-150 focus-visible:border-blue-400"
      />
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-pink-400">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-blue-700 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
      >
        {pending ? "Checking..." : "Enter"}
      </button>
    </form>
  );
}
