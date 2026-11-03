"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Search } from "lucide-react";
import { SHELL_EVENTS } from "./useShortcuts";

type DialogComponent = ComponentType<{ initialOpen?: boolean }>;

const IDLE_TIMEOUT_MS = 3000;

const loadDialog = () => import("./CommandPaletteDialog").then((mod) => mod.default as DialogComponent);

/**
 * ⌘K palette host. The dialog (cmdk, the dialog primitive, the command lists) is code-split out of the initial JS
 * (DESIGN-V3 §8 item 10): it preloads once the browser is idle, and an open or toggle event that arrives first loads it
 * immediately and opens it. Once loaded, the dialog owns its own listeners.
 */
export function CommandPalette() {
  const [Dialog, setDialog] = useState<DialogComponent | null>(null);
  const [openOnLoad, setOpenOnLoad] = useState(false);

  useEffect(() => {
    if (Dialog) return;
    let live = true;
    const load = () =>
      loadDialog()
        .then((C) => live && setDialog(() => C))
        .catch(() => undefined); // a failed chunk load retries on the next open event
    const onEvent = () => {
      setOpenOnLoad(true);
      void load();
    };
    window.addEventListener(SHELL_EVENTS.openPalette, onEvent);
    window.addEventListener(SHELL_EVENTS.togglePalette, onEvent);
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(() => void load(), { timeout: IDLE_TIMEOUT_MS })
        : window.setTimeout(() => void load(), IDLE_TIMEOUT_MS);
    return () => {
      live = false;
      window.removeEventListener(SHELL_EVENTS.openPalette, onEvent);
      window.removeEventListener(SHELL_EVENTS.togglePalette, onEvent);
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [Dialog]);

  return Dialog ? <Dialog initialOpen={openOnLoad} /> : null;
}

/** Top-bar trigger: "Search or run a command ⌘K". */
export function PaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SHELL_EVENTS.openPalette))}
      aria-keyshortcuts="Meta+K Control+K"
      className="inline-flex h-8 w-full max-w-[360px] items-center gap-2 rounded-md border border-line bg-ink-1 px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:border-line-hover hover:text-fg-2"
    >
      <Search className="size-3.5" strokeWidth={1.5} aria-hidden />
      <span className="flex-1 truncate text-left">Search or run a command</span>
      <kbd className="hidden h-5 items-center rounded-[4px] border border-line px-1.5 font-mono text-[11px] text-fg-3 sm:inline-flex">⌘K</kbd>
    </button>
  );
}
