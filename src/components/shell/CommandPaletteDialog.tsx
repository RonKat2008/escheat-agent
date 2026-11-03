"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowRight, CornerDownLeft, MessagesSquare, Search, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { readMotionPref, setMotionPref } from "@/components/viz/core/useRenderTier";
import type { NextAction } from "@/lib/next-action";
import { cn } from "@/lib/utils";
import { getNextActionAction, searchItemsAction, type PaletteItem } from "./actions";
import { DO_COMMANDS, GO_COMMANDS, matches, pushRecent, RECENT_KEY, type DoCommand } from "./palette-commands";
import { keyChips } from "./shortcuts";
import { SHELL_EVENTS } from "./useShortcuts";

const GROUP_CLASS =
  "mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase";
const ITEM_CLASS =
  "flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13px] text-fg-2 data-[selected=true]:bg-ink-3 data-[selected=true]:text-fg-1";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function Chips({ keys }: { keys?: readonly string[] }) {
  if (!keys) return null;
  return <Kbd keys={keyChips(keys)} className="ml-auto" />;
}

/**
 * ⌘K palette v2 (§5.3): Do (verbs), Go (pages), Find (items), Ask (chat). Recent commands are pinned on top.
 * Loaded on demand by CommandPalette.tsx (cmdk stays out of the initial JS); `initialOpen` carries the event that
 * triggered the load.
 */
export default function CommandPaletteDialog({ initialOpen = false }: { initialOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [next, setNext] = useState<NextAction | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  // Controlled highlight: results arrive after the list mounts, so cmdk would otherwise keep the old highlight.
  const [active, setActive] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onToggle = () => setOpen((o) => !o);
    window.addEventListener(SHELL_EVENTS.openPalette, onOpen);
    window.addEventListener(SHELL_EVENTS.togglePalette, onToggle);
    return () => {
      window.removeEventListener(SHELL_EVENTS.openPalette, onOpen);
      window.removeEventListener(SHELL_EVENTS.togglePalette, onToggle);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is read when the palette opens
    setRecent(readRecent());
    let live = true;
    getNextActionAction()
      .then((a) => live && setNext(a))
      .catch(() => live && setNext(null));
    return () => {
      live = false;
    };
  }, [open]);

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
        .then((r) => {
          if (mine !== seq.current) return;
          setItems(r);
          if (r[0]) setActive(`item-${r[0].id}`);
        })
        .catch(() => mine === seq.current && setItems([]));
    }, 120);
    return () => clearTimeout(t);
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const remember = (id: string) => {
    const list = pushRecent(readRecent(), id);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      /* storage blocked: recents are a convenience */
    }
  };

  function go(href: string, recentId?: string) {
    if (recentId) remember(recentId);
    close();
    router.push(href);
  }

  async function runDo(cmd: DoCommand) {
    remember(`do:${cmd.id}`);
    if (cmd.href) return go(cmd.href);
    close();
    if (cmd.id === "toggle-motion") {
      const on = readMotionPref() !== "reduce";
      setMotionPref(on ? "reduce" : "system");
      toast.success(on ? "Reduce motion is on" : "Reduce motion is off", { description: on ? "Animations render their final state." : "Motion follows your system setting." });
      return;
    }
    if (cmd.id === "advance-clock") {
      try {
        const res = await fetch("/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "advance", days: 30 }) });
        const json = (await res.json()) as { today?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? `Clock request failed (${res.status})`);
        toast.success(`Demo date is now ${json.today}`);
        router.refresh();
      } catch (e) {
        toast.error("Could not move the demo clock", { description: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const q = query.trim();
  const doCmds = DO_COMMANDS.filter((c) => matches(q, c.label, c.keywords));
  const goCmds = GO_COMMANDS.filter((c) => matches(q, c.item.label));
  const showNext = next !== null && matches(q, next.label, next.detail ?? undefined, "next action");
  const recentDo = q ? [] : recent.map((id) => DO_COMMANDS.find((c) => `do:${c.id}` === id)).filter((c): c is DoCommand => Boolean(c));
  const recentGo = q ? [] : recent.map((id) => GO_COMMANDS.find((c) => `go:${c.item.href}` === id)).filter((c): c is (typeof GO_COMMANDS)[number] => Boolean(c));

  // Visible option values in render order: the highlight falls back to the first one.
  const order = [
    ...items.map((i) => `item-${i.id}`),
    ...recentDo.map((c) => `recent-do-${c.id}`),
    ...recentGo.map((c) => `recent-go-${c.item.href}`),
    ...(showNext ? ["do-next"] : []),
    ...doCmds.map((c) => `do-${c.id}`),
    ...goCmds.map((c) => `page-${c.item.href}`),
    ...(q ? ["ask"] : []),
  ];
  const highlight = order.includes(active) ? active : (order[0] ?? "");

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent showCloseButton={false} className="top-[16%] translate-y-0 gap-0 overflow-hidden border-line-strong bg-ink-2 p-0 shadow-[var(--shadow-float)] sm:max-w-xl" data-testid="command-palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Run a command, go to a page, find an item, or ask the agent</DialogDescription>
        <Command label="Command palette" shouldFilter={false} value={highlight} onValueChange={setActive} className="flex flex-col">
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, check numbers, payees, or run a command"
              className="h-12 flex-1 bg-transparent text-sm text-fg-1 outline-none placeholder:text-fg-3 focus-visible:outline-none"
            />
          </div>
          <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-sm text-fg-2">No matches.</Command.Empty>
            {items.length > 0 && (
              <Command.Group heading="Find" className={GROUP_CLASS}>
                {items.map((i) => (
                  <Command.Item key={i.id} value={`item-${i.id}`} onSelect={() => go(`/items?item=${i.id}`)} className={ITEM_CLASS}>
                    <span className="w-14 font-mono text-xs text-fg-3">{i.checkNumber ? `#${i.checkNumber}` : "—"}</span>
                    <span className="flex-1 truncate">{i.payee}</span>
                    <span className="text-xs text-fg-3">{i.state}</span>
                    <span className="num text-[13px] text-fg-1">{i.amount}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {recentDo.length + recentGo.length > 0 && (
              <Command.Group heading="Recent" className={GROUP_CLASS}>
                {recentDo.map((c) => (
                  <Command.Item key={c.id} value={`recent-do-${c.id}`} onSelect={() => void runDo(c)} className={ITEM_CLASS}>
                    <Zap className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
                    <span className="flex-1 truncate">{c.label}</span>
                    <Chips keys={c.keys} />
                  </Command.Item>
                ))}
                {recentGo.map((c) => (
                  <Command.Item key={c.item.href} value={`recent-go-${c.item.href}`} onSelect={() => go(c.item.href, `go:${c.item.href}`)} className={ITEM_CLASS}>
                    <c.item.icon className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
                    <span className="flex-1 truncate">{c.item.label}</span>
                    <Chips keys={c.keys} />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {(showNext || doCmds.length > 0) && (
              <Command.Group heading="Do" className={GROUP_CLASS}>
                {showNext && next ? (
                  <Command.Item value="do-next" onSelect={() => go(next.href)} className={ITEM_CLASS} data-testid="palette-next-action">
                    <Sparkles className={cn("size-4", next.human ? "text-pink-400" : "text-blue-400")} strokeWidth={1.5} aria-hidden />
                    <span className="flex-1 truncate">
                      <span className="text-fg-1">{next.label}</span>
                      {next.detail ? <span className="text-fg-3"> · {next.detail}</span> : null}
                    </span>
                    <Chips keys={["."]} />
                  </Command.Item>
                ) : null}
                {doCmds.map((c) => (
                  <Command.Item key={c.id} value={`do-${c.id}`} onSelect={() => void runDo(c)} className={ITEM_CLASS}>
                    <Zap className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
                    <span className="flex-1 truncate">{c.label}</span>
                    <Chips keys={c.keys} />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {goCmds.length > 0 && (
              <Command.Group heading="Go" className={GROUP_CLASS}>
                {goCmds.map((c) => (
                  <Command.Item key={c.item.href} value={`page-${c.item.href}`} onSelect={() => go(c.item.href, `go:${c.item.href}`)} className={ITEM_CLASS}>
                    <c.item.icon className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
                    <span className="flex-1 truncate">{c.item.label}</span>
                    <Chips keys={c.keys} />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {q ? (
              <Command.Group heading="Ask" className={GROUP_CLASS}>
                <Command.Item value="ask" onSelect={() => go(`/chat?q=${encodeURIComponent(q)}`)} className={ITEM_CLASS}>
                  <MessagesSquare className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
                  <span className="flex-1 truncate">
                    Ask the agent: <span className="text-fg-1">{q}</span>
                  </span>
                  <ArrowRight className="size-3.5 text-fg-3" strokeWidth={1.5} aria-hidden />
                </Command.Item>
              </Command.Group>
            ) : null}
          </Command.List>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs text-fg-3">
            <span className="truncate">Type a check number like 10482 to jump to it.</span>
            <span className="inline-flex shrink-0 items-center gap-3">
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Kbd>?</Kbd> shortcuts
              </span>
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="size-3" aria-hidden /> run
              </span>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
