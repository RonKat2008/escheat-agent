"use client";

import { useId, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const KEY = "escheat.approver";
const DEFAULT_APPROVER = "Demo reviewer";

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

function read(): string {
  try {
    return localStorage.getItem(KEY) || memory || DEFAULT_APPROVER;
  } catch {
    return memory ?? DEFAULT_APPROVER;
  }
}

/** Remembers who is approving, per browser. The server records this name on the approval row. */
export function useApprover(): [string, (v: string) => void] {
  const name = useSyncExternalStore(subscribe, read, () => DEFAULT_APPROVER);
  const update = (v: string) => {
    memory = v;
    try {
      localStorage.setItem(KEY, v);
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
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Approving as
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={80}
        autoComplete="name"
        className="h-9 w-full rounded-lg border border-strong bg-sunken px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
