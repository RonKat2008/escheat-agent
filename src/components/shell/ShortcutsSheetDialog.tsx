"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { keyChips, SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";
import { SHELL_EVENTS } from "./useShortcuts";

/** `?` opens the full keyboard map, generated from the same registry as the handlers (§5.3). */
export default function ShortcutsSheetDialog({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(SHELL_EVENTS.openShortcuts, onOpen);
    return () => window.removeEventListener(SHELL_EVENTS.openShortcuts, onOpen);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto border-line-strong bg-ink-2 sm:max-w-2xl" data-testid="shortcuts-sheet">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Shortcuts are off while you type in a field.</DialogDescription>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((g) => {
            const list = SHORTCUTS.filter((s) => s.group === g);
            if (list.length === 0) return null;
            return (
              <section key={g} aria-labelledby={`sc-${g.replace(/\s/g, "-")}`}>
                <h3 id={`sc-${g.replace(/\s/g, "-")}`} className="instrument-label mb-2">
                  {g}
                </h3>
                <dl className="space-y-1.5">
                  {list.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-4 text-[13px]">
                      <dt className="text-fg-2">{s.label}</dt>
                      <dd>
                        <Kbd keys={keyChips(s.keys)} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
