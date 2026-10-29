"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
        className="h-10 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-md bg-at-risk px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
      >
        {pending ? "Checking..." : "Enter"}
      </button>
    </form>
  );
}
