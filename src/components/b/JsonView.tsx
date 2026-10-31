"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function Scalar({ v }: { v: string | number | boolean | null }) {
  if (v === null) return <span className="text-fg-3 italic">null</span>;
  if (typeof v === "string") return <span className="break-words whitespace-pre-wrap text-blue-300">&quot;{v}&quot;</span>;
  if (typeof v === "number") return <span className="text-fg-1">{v}</span>;
  return <span className="text-fg-2">{String(v)}</span>;
}

function Node({ k, v, depth, defaultOpen }: { k?: string; v: Json; depth: number; defaultOpen: boolean }) {
  const isObj = v !== null && typeof v === "object";
  const [open, setOpen] = useState(defaultOpen && depth < 2);
  const key = k !== undefined ? <span className="text-fg-2">{k}</span> : null;
  if (!isObj) {
    return (
      <div className="py-px pl-4">
        {key}
        {key ? <span className="text-fg-3">: </span> : null}
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
        className="-ml-0.5 inline-flex items-center gap-0.5 rounded px-0.5 py-px text-left transition-colors duration-100 hover:bg-ink-3 focus-visible:outline-2 focus-visible:outline-blue-400"
      >
        <ChevronRight className={cn("size-3 shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        {key}
        {key ? <span className="text-fg-3">: </span> : null}
        <span className="text-fg-3">
          {openB}
          {open ? "" : ` ${entries.length} ${Array.isArray(v) ? "items" : "keys"} `}
          {open ? "" : closeB}
        </span>
      </button>
      {open ? (
        <>
          <div className="ml-[7px] border-l border-line pl-1.5">
            {entries.length === 0 ? <div className="pl-4 text-fg-3 italic">empty</div> : null}
            {entries.map(([ck, cv]) => (
              <Node key={ck} k={ck} v={cv as Json} depth={depth + 1} defaultOpen={defaultOpen} />
            ))}
          </div>
          <span className="pl-4 text-fg-3">{closeB}</span>
        </>
      ) : null}
    </div>
  );
}

/** Collapsible JSON in an ink-2 code well. Keys fg-2, strings blue-300, numbers fg-1, null fg-3. */
export function JsonView({ value, label, defaultOpen = true, className }: { value: unknown; label?: string; defaultOpen?: boolean; className?: string }) {
  let safe: Json;
  try {
    safe = JSON.parse(JSON.stringify(value ?? null)) as Json;
  } catch {
    safe = String(value);
  }
  return (
    <div className={cn("min-w-0 rounded-[10px] border border-line bg-ink-2", className)}>
      <div className="flex h-9 items-center justify-between border-b border-line pr-1 pl-3">
        <span className="text-xs text-fg-3">{label ?? "JSON"}</span>
        <CopyButton value={JSON.stringify(safe, null, 2)} />
      </div>
      <div className="max-h-[420px] overflow-auto px-3 py-2.5 font-mono text-xs leading-5">
        <Node v={safe} depth={0} defaultOpen={defaultOpen} />
      </div>
    </div>
  );
}
