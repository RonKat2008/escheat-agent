"use client";

import { useEffect, useRef } from "react";
import { createMatcher, eventToken, isTypingTarget, type Shortcut } from "./shortcuts";

/** Window events the shell uses to talk to its own overlays (also usable by pages). */
export const SHELL_EVENTS = {
  openPalette: "open-command-palette",
  togglePalette: "toggle-command-palette",
  openShortcuts: "open-shortcuts-sheet",
  toggleSidebar: "toggle-sidebar",
  runNextAction: "run-next-action",
} as const;

export function emitShell(name: (typeof SHELL_EVENTS)[keyof typeof SHELL_EVENTS]): void {
  window.dispatchEvent(new Event(name));
}

/** Is a modal overlay (dialog/sheet) open? Shell shortcuts other than mod+k stay out of its way. */
function modalOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]'));
}

/**
 * The shell's one global key handler, driven by the registry in ./shortcuts.ts. Listens in the capture phase so a
 * chord like `g a` is consumed before a page's own `a` handler sees it. Disabled while focus is in a field.
 */
export function useShortcuts(onShortcut: (s: Shortcut) => void): void {
  const handler = useRef(onShortcut);
  useEffect(() => {
    handler.current = onShortcut;
  }, [onShortcut]);

  useEffect(() => {
    const feed = createMatcher();
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      const token = eventToken(e);
      const isMod = token.startsWith("mod+");
      if (!isMod && (isTypingTarget(e.target as HTMLElement | null) || modalOpen())) return;
      if (e.altKey) return;
      const hit = feed(token, e.timeStamp || performance.now());
      if (hit === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (hit !== "pending") handler.current(hit);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}
