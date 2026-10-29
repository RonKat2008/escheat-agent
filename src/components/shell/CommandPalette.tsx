"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NAV_ITEMS, SETTINGS_ITEM } from "./nav-items";
import { searchItemsAction, type PaletteItem } from "./actions";

const PAGES = [...NAV_ITEMS, SETTINGS_ITEM];

/** Cmd/Ctrl+K: jump to pages, or to an item by check number or payee. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      searchItemsAction(q)
        .then((r) => mine === seq.current && setItems(r))
        .catch(() => mine === seq.current && setItems([]));
    }, 120);
    return () => clearTimeout(t);
  }, [query]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search pages and items</DialogDescription>
        <Command label="Command palette" shouldFilter={false} className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, check numbers, payees"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-sm text-muted-foreground">No matches.</Command.Empty>
            {items.length > 0 && (
              <Command.Group heading="Items" className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase">
                {items.map((i) => (
                  <Command.Item
                    key={i.id}
                    value={`item-${i.id}`}
                    onSelect={() => go(`/items?item=${i.id}`)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-raised"
                  >
                    <span className="w-14 font-mono text-xs text-muted-foreground">{i.checkNumber ? `#${i.checkNumber}` : "—"}</span>
                    <span className="flex-1 truncate">{i.payee}</span>
                    <span className="font-mono text-xs text-muted-foreground">{i.state}</span>
                    <span className="font-mono text-xs">{i.amount}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase">
              {PAGES.filter((p) => !query.trim() || p.label.toLowerCase().includes(query.trim().toLowerCase())).map((p) => (
                <Command.Item
                  key={p.href}
                  value={`page-${p.href}`}
                  onSelect={() => go(p.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-raised"
                >
                  <p.icon className="size-4 text-muted-foreground" aria-hidden />
                  {p.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <span>Type a check number like 10482 to jump to it.</span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="size-3" aria-hidden /> open
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function PaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className="inline-flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:border-strong hover:bg-raised"
    >
      <Search className="size-3.5" aria-hidden />
      <span className="flex-1 truncate text-left">Search items, pages</span>
      <kbd className="hidden rounded border border-border px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}
