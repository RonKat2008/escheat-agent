"use client";

import { useEffect, useRef } from "react";
import { eventToken, isTypingTarget, SHORTCUTS, type Shortcut } from "@/components/shell/shortcuts";

/** The approvals keys, read from the shell registry (handledBy "page") so the ? sheet, hints and handlers never drift. */
const PAGE_KEYS = ["list-down", "list-up", "approve", "approve-next", "edit"] as const;
type PageKey = (typeof PAGE_KEYS)[number];
const BINDINGS: { id: PageKey; token: string }[] = PAGE_KEYS.flatMap((id) => {
  const s: Shortcut | undefined = SHORTCUTS.find((x) => x.id === id && x.handledBy === "page");
  return s && s.keys.length === 1 ? [{ id, token: s.keys[0]! }] : [];
});

export interface ApprovalKeyHandlers {
  onMove: (dir: 1 | -1) => boolean;
  /** `a` approves; ⌘↵ approves and advances. Approving is never more than recording the reviewer's approval. */
  onApprove: (advance: boolean) => void;
  onEdit: () => void;
}

/**
 * j/k move through the queue, a approves, ⌘↵ approves and moves to the next, e jumps to compose/recompose.
 * Single keys are ignored while typing; ⌘↵ also works from the Approver field. Modal dialogs keep their keys.
 */
export function useApprovalKeys(handlers: ApprovalKeyHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
      const token = eventToken(e);
      const hit = BINDINGS.find((b) => b.token === token);
      if (!hit) return;
      if (hit.id !== "approve-next" && (isTypingTarget(e.target as HTMLElement | null) || e.metaKey || e.ctrlKey)) return;
      if (e.repeat && hit.id !== "list-down" && hit.id !== "list-up") return;
      const h = ref.current;
      if (hit.id === "list-down" || hit.id === "list-up") {
        if (h.onMove(hit.id === "list-down" ? 1 : -1)) e.preventDefault();
        return;
      }
      e.preventDefault();
      if (hit.id === "approve") h.onApprove(false);
      else if (hit.id === "approve-next") h.onApprove(true);
      else h.onEdit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
