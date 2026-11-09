"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Search } from "lucide-react";
import { SHELL_EVENTS } from "./useShortcuts";
import { ROUND_BUTTON } from "./chrome";

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

/** Top-bar trigger (V4): a round glass search button, "Search or run a command ⌘K". */
export function PaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SHELL_EVENTS.openPalette))}
      aria-keyshortcuts="Meta+K Control+K"
      aria-label="Search or run a command (⌘K)"
      title="Search or run a command (⌘K)"
      className={ROUND_BUTTON}
    >
      <Search className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
