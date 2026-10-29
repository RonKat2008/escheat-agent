"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

const KEY = "escheat.approver";
const DEFAULT_APPROVER = "Demo reviewer";

/** Remembers who is approving, per browser. The server records this name on the approval row. */
export function useApprover(): [string, (v: string) => void] {
  const [name, setName] = useState(DEFAULT_APPROVER);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setName(saved);
    } catch {
      /* storage blocked */
    }
  }, []);
  const update = (v: string) => {
    setName(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* storage blocked */
    }
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
