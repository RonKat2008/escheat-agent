/**
 * The keyboard registry (DESIGN-V3 §5.3-5.4). One list feeds the shell's global handler, the kbd hints in the palette
 * and Loop Bar, `aria-keyshortcuts`, and the `?` Shortcuts sheet, so hints and handlers never drift.
 * Pure module: no DOM, no React. The shell dispatches; pages keep their own list handlers (j/k/x/d/a/r/e) and only
 * document them here with `handledBy: "page"`.
 */

export type ShortcutGroup = "Anywhere" | "Go to" | "Lists" | "Items" | "Approvals" | "Overlays";

export interface Shortcut {
  id: string;
  /** Key sequence. A chord like "g d" is ["g", "d"]; "mod" means Cmd on macOS, Ctrl elsewhere. */
  keys: readonly string[];
  label: string;
  group: ShortcutGroup;
  /** "shell" = handled globally by useShortcuts; "page" = the page owns the handler, listed for the sheet. */
  handledBy: "shell" | "page";
  /** Navigation target for "go" shortcuts. */
  href?: string;
}

/** `g` chords to pages (§5.4: g then d i p a f c r e s). */
export const GO_TARGETS = [
  { key: "d", href: "/dashboard", label: "Dashboard" },
  { key: "i", href: "/items", label: "Items" },
  { key: "p", href: "/payees", label: "Payees" },
  { key: "a", href: "/approvals", label: "Approvals" },
  { key: "f", href: "/forecast", label: "Forecast" },
  { key: "c", href: "/chat", label: "Chat" },
  { key: "r", href: "/rules", label: "Rules" },
  { key: "e", href: "/reports", label: "Reports" },
  { key: "s", href: "/settings/integrations", label: "Settings" },
] as const;

/**
 * Loop stage chords. §5.1 asks for g t / g d / g a / g f, but g d and g f already mean Dashboard and Forecast in the
 * §5.4 table, so the stages that collide get free letters: Draft = g l (letters), File = g y.
 */
export const LOOP_CHORDS = { triage: "t", draft: "l", approve: "a", file: "y" } as const;

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "palette", keys: ["mod+k"], label: "Open the command palette", group: "Anywhere", handledBy: "shell" },
  { id: "shortcuts", keys: ["?"], label: "Show keyboard shortcuts", group: "Anywhere", handledBy: "shell" },
  { id: "next-action", keys: ["."], label: "Run the next best action", group: "Anywhere", handledBy: "shell" },
  { id: "sidebar", keys: ["["], label: "Collapse or expand the sidebar", group: "Anywhere", handledBy: "shell" },
  ...GO_TARGETS.map((t) => ({ id: `go-${t.key}`, keys: ["g", t.key], label: t.label, group: "Go to" as const, handledBy: "shell" as const, href: t.href })),
  { id: "loop-triage", keys: ["g", LOOP_CHORDS.triage], label: "Loop: Triage", group: "Go to", handledBy: "shell", href: "/items?view=needs-action" },
  { id: "loop-draft", keys: ["g", LOOP_CHORDS.draft], label: "Loop: Draft", group: "Go to", handledBy: "shell", href: "/items?view=draft-ready" },
  { id: "loop-file", keys: ["g", LOOP_CHORDS.file], label: "Loop: File", group: "Go to", handledBy: "shell", href: "/reports?filter=approved" },
  { id: "list-search", keys: ["/"], label: "Focus the filter or search", group: "Lists", handledBy: "page" },
  { id: "list-down", keys: ["j"], label: "Move selection down", group: "Lists", handledBy: "page" },
  { id: "list-up", keys: ["k"], label: "Move selection up", group: "Lists", handledBy: "page" },
  { id: "list-open", keys: ["enter"], label: "Open the selected row", group: "Lists", handledBy: "page" },
  { id: "list-toggle", keys: ["x"], label: "Toggle selection", group: "Lists", handledBy: "page" },
  { id: "list-extend-down", keys: ["shift+arrowdown"], label: "Extend selection down", group: "Lists", handledBy: "page" },
  { id: "list-extend-up", keys: ["shift+arrowup"], label: "Extend selection up", group: "Lists", handledBy: "page" },
  { id: "items-draft", keys: ["d"], label: "Draft outreach for the selection", group: "Items", handledBy: "page" },
  { id: "approve", keys: ["a"], label: "Approve (confirms irreversible actions)", group: "Approvals", handledBy: "page" },
  { id: "approve-next", keys: ["mod+enter"], label: "Approve and advance to the next", group: "Approvals", handledBy: "page" },
  { id: "reject", keys: ["r"], label: "Reject (focuses the reason)", group: "Approvals", handledBy: "page" },
  { id: "edit", keys: ["e"], label: "Edit the draft", group: "Approvals", handledBy: "page" },
  { id: "escape", keys: ["escape"], label: "Close or clear the selection", group: "Overlays", handledBy: "page" },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Anywhere", "Go to", "Lists", "Items", "Approvals", "Overlays"];

export function shortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

const KEY_LABEL: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  enter: "↵",
  escape: "Esc",
  arrowdown: "↓",
  arrowup: "↑",
};

/** Display tokens for kbd chips: ["mod+k"] -> ["⌘K"], ["g","d"] -> ["G","D"]. */
export function keyChips(keys: readonly string[], mac = true): string[] {
  return keys.map((k) =>
    k
      .split("+")
      .map((p) => (p === "mod" ? (mac ? "⌘" : "Ctrl ") : (KEY_LABEL[p] ?? (p.length === 1 ? p.toUpperCase() : p))))
      .join(""),
  );
}

/** Value for aria-keyshortcuts: "Meta+K Control+K", "G D". */
export function ariaKeys(keys: readonly string[]): string {
  const one = (k: string, mod: "Meta" | "Control") =>
    k
      .split("+")
      .map((p) => (p === "mod" ? mod : p === "shift" ? "Shift" : p === "enter" ? "Enter" : p === "escape" ? "Escape" : p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
      .join("+");
  if (keys.length === 1 && keys[0]!.includes("mod")) return `${one(keys[0]!, "Meta")} ${one(keys[0]!, "Control")}`;
  return keys.map((k) => one(k, "Meta")).join(" ");
}

/** Minimal keyboard event shape (so the matcher is testable without a DOM). */
export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Normalise an event to a registry token: "mod+k", "g", "?", ".", "shift+arrowdown". */
export function eventToken(e: KeyLike): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  // Shift is part of printable symbols ("?" is shift+/), so only record it for named keys.
  if (e.shiftKey && e.key.length > 1) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/** Is focus in a field where typed keys belong to the user (input, textarea, select, contenteditable)? */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return role === "textbox" || role === "combobox";
}

export const CHORD_TIMEOUT_MS = 1200;

/**
 * Sequence matcher over the shell-handled shortcuts. Feed it key tokens with a timestamp; it returns the matched
 * shortcut, "pending" while a chord prefix is open, or null.
 */
export function createMatcher(list: readonly Shortcut[] = SHORTCUTS.filter((s) => s.handledBy === "shell"), timeoutMs = CHORD_TIMEOUT_MS) {
  let buffer: string[] = [];
  let last = 0;
  return function feed(token: string, now: number): Shortcut | "pending" | null {
    if (now - last > timeoutMs) buffer = [];
    last = now;
    const seq = [...buffer, token];
    const exact = list.find((s) => s.keys.length === seq.length && s.keys.every((k, i) => k === seq[i]));
    if (exact) {
      buffer = [];
      return exact;
    }
    if (list.some((s) => s.keys.length > seq.length && seq.every((k, i) => s.keys[i] === k))) {
      buffer = seq;
      return "pending";
    }
    // A failed chord continuation may itself start a new sequence or be a single-key shortcut.
    buffer = [];
    if (seq.length > 1) return feed(token, now);
    return null;
  };
}
