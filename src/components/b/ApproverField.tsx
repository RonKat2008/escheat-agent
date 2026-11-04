"use client";

import { useId, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const KEY = "escheat.approver";
/** R5-10: no prefill. The field starts empty; a typed name is remembered for this browser session only. */
const EMPTY_APPROVER = "";

const EVENT = "escheat-approver-change";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Fallback when storage is blocked (private windows), so typing still works. */
let memory: string | null = null;

/**
 * Reads the session's typed name, or empty. A cleared field stays empty so the "name required" state can show.
 */
function read(): string {
  try {
    return sessionStorage.getItem(KEY) ?? memory ?? EMPTY_APPROVER;
  } catch {
    return memory ?? EMPTY_APPROVER;
  }
}

/** Remembers who is approving, per browser session. The server records this name on the approval row. */
export function useApprover(): [string, (v: string) => void] {
  const name = useSyncExternalStore(subscribe, read, () => EMPTY_APPROVER);
  const update = (v: string) => {
    memory = v;
    try {
      sessionStorage.setItem(KEY, v);
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [name, update];
}

export function ApproverField({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const id = useId();
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="text-xs text-fg-3">
        Approving as
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={80}
        placeholder="Your name"
        aria-required="true"
        autoComplete="name"
        className="h-8 w-full rounded-md border border-line-hover bg-ink-2 px-2.5 text-[13px] text-fg-1 transition-[border-color] duration-150 outline-none hover:border-line-strong focus-visible:border-blue-400"
      />
    </div>
  );
}
