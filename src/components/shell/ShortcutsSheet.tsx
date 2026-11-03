"use client";

import { useEffect, useState, type ComponentType } from "react";
import { SHELL_EVENTS } from "./useShortcuts";

type DialogComponent = ComponentType<{ initialOpen?: boolean }>;

/**
 * Host for the `?` keyboard map. The dialog primitive and the shortcut registry render are code-split out of the first
 * load; the first open event loads the chunk and opens it. Once loaded, the dialog owns its own listener.
 */
export function ShortcutsSheet() {
  const [Dialog, setDialog] = useState<DialogComponent | null>(null);
  useEffect(() => {
    if (Dialog) return;
    let live = true;
    const onOpen = () => {
      void import("./ShortcutsSheetDialog")
        .then((mod) => live && setDialog(() => mod.default as DialogComponent))
        .catch(() => undefined); // a failed chunk load retries on the next open event
    };
    window.addEventListener(SHELL_EVENTS.openShortcuts, onOpen);
    return () => {
      live = false;
      window.removeEventListener(SHELL_EVENTS.openShortcuts, onOpen);
    };
  }, [Dialog]);
  return Dialog ? <Dialog initialOpen /> : null;
}
