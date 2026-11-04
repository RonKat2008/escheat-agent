"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DrawerPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

interface ItemDrawerProps {
  open: boolean;
  /** Mounted after first paint (a row was clicked), so it starts closed and slides in. A deep link renders it open. */
  lateMount: boolean;
  onClose: () => void;
  /** The row's open button to refocus on close, or null to let the dialog pick. */
  getFinalFocus: () => HTMLElement | null;
  /** Runs once the close transition has finished and the popup is gone (focus has been handed back by then). */
  onClosed?: () => void;
  children: ReactNode;
}

/** The item drawer shell (DESIGN-V3 §6.4). Split out of items-client so the dialog primitive loads on first open. */
export default function ItemDrawer({ open, lateMount, onClose, getFinalFocus, onClosed, children }: ItemDrawerProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [shown, setShown] = useState(open && !lateMount);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow `open` one frame after mount so a late mount animates in
    setShown(open);
  }, [open]);
  return (
    <DrawerPrimitive.Root
      open={shown}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onOpenChangeComplete={(o) => {
        if (!o) onClosed?.();
      }}
      // Focus is trapped in the drawer while it is open, but the table behind it stays clickable and scroll is not locked.
      modal="trap-focus"
      disablePointerDismissal
    >
      <DrawerPrimitive.Portal>
        {/* Below lg the drawer covers the table, so dim it and let a tap outside close it. Wide screens stay scrim-free. */}
        <div aria-hidden data-testid="item-drawer-scrim" onClick={onClose} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />
        <DrawerPrimitive.Popup
          initialFocus={titleRef}
          finalFocus={() => getFinalFocus() ?? true}
          data-testid="item-drawer"
          aria-label="Item details"
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-hover bg-ink-1 text-sm shadow-[var(--shadow-overlay)] outline-none transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-full data-ending-style:duration-200 data-ending-style:ease-[cubic-bezier(0.65,0,0.35,1)] data-starting-style:translate-x-full sm:w-[560px]"
        >
          <DrawerPrimitive.Title ref={titleRef} tabIndex={-1} className="sr-only outline-none">
            Item details
          </DrawerPrimitive.Title>
          <DrawerPrimitive.Close
            aria-label="Close item details"
            className="absolute top-3.5 right-3.5 z-10 grid size-8 place-items-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-ink-3 hover:text-fg-1"
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          </DrawerPrimitive.Close>
          <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
