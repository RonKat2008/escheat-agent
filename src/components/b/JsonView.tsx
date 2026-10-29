"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function Scalar({ v }: { v: string | number | boolean | null }) {
  if (v === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof v === "string") return <span className="break-words whitespace-pre-wrap text-sky">&quot;{v}&quot;</span>;
  if (typeof v === "number") return <span className="text-foreground">{v}</span>;
  return <span className="text-slate">{String(v)}</span>;
}

function Node({ k, v, depth, defaultOpen }: { k?: string; v: Json; depth: number; defaultOpen: boolean }) {
  const isObj = v !== null && typeof v === "object";
  const [open, setOpen] = useState(defaultOpen && depth < 2);
  const key = k !== undefined ? <span className="text-slate">{k}</span> : null;
  if (!isObj) {
    return (
      <div className="py-px pl-4">
        {key}
        {key ? <span className="text-muted-foreground">: </span> : null}
        <Scalar v={v} />
      </div>
    );
  }
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
  const [openB, closeB] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-ml-0.5 inline-flex items-center gap-0.5 rounded px-0.5 py-px text-left hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} aria-hidden />
        {key}
        {key ? <span className="text-muted-foreground">: </span> : null}
        <span className="text-muted-foreground">
          {openB}
          {open ? "" : ` ${entries.length} ${Array.isArray(v) ? "items" : "keys"} `}
          {open ? "" : closeB}
        </span>
      </button>
      {open ? (
        <>
          <div className="ml-[7px] border-l border-border pl-1.5">
            {entries.length === 0 ? <div className="pl-4 text-muted-foreground italic">empty</div> : null}
            {entries.map(([ck, cv]) => (
              <Node key={ck} k={ck} v={cv as Json} depth={depth + 1} defaultOpen={defaultOpen} />
            ))}
          </div>
          <span className="pl-4 text-muted-foreground">{closeB}</span>
        </>
      ) : null}
    </div>
  );
}

/** Collapsible JSON with syntax tint on the sunken surface. Keys slate, strings sky, numbers plain. */
export function JsonView({ value, label, defaultOpen = true, className }: { value: unknown; label?: string; defaultOpen?: boolean; className?: string }) {
  let safe: Json;
  try {
    safe = JSON.parse(JSON.stringify(value ?? null)) as Json;
  } catch {
    safe = String(value);
  }
  return (
    <div className={cn("rounded-lg border border-border bg-sunken", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{label ?? "JSON"}</span>
        <CopyButton value={JSON.stringify(safe, null, 2)} />
      </div>
      <div className="max-h-[420px] overflow-auto p-3 font-mono text-xs leading-5">
        <Node v={safe} depth={0} defaultOpen={defaultOpen} />
      </div>
    </div>
  );
}
