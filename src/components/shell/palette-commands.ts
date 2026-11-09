/**
 * Static command definitions for the palette's Do and Go sections (§5.3). Pure data plus a tiny filter, so the
 * palette component stays about rendering. Each command lists the registry shortcut it shares, if any.
 */
import { CLOSE_PACK_HREF } from "@/lib/close-pack/href";
import { CFO_BRIEF_HREF } from "@/lib/cfo-brief/href";
import { LOOP_HREF } from "@/lib/next-action";
import { NAV_ITEMS, SETTINGS_ITEM, type NavItem } from "./nav-items";
import { TOUR_START_HREF } from "@/components/tour/tour-url";
import { GO_TARGETS } from "./shortcuts";

export type DoCommandId =
  | "approve-next"
  | "draft-due"
  | "report-CA"
  | "report-DE"
  | "report-TX"
  | "recovery-search"
  | "cfo-brief"
  | "close-pack"
  | "advance-clock"
  | "toggle-motion"
  | "start-tour"
  | "replay-tour"
  | "mode-ask"
  | "mode-dashboard";

export interface DoCommand {
  id: DoCommandId;
  label: string;
  /** Extra words that should match the filter. */
  keywords?: string;
  href?: string;
  /** A file to download (fetched by the browser, not navigated to). */
  download?: string;
  keys?: readonly string[];
}

export const DO_COMMANDS: readonly DoCommand[] = [
  { id: "mode-ask", label: "Switch to Ask", keywords: "mode chat agent question do", href: "/ask", keys: ["mod+/"] },
  // The palette sends this one to the last Dashboard page of the session (mode.ts), falling back to /dashboard.
  { id: "mode-dashboard", label: "Switch to Dashboard", keywords: "mode overview view pages", href: "/dashboard", keys: ["mod+/"] },
  { id: "approve-next", label: "Approve next", keywords: "review approval queue letter", href: LOOP_HREF.approve, keys: ["g", "a"] },
  { id: "draft-due", label: "Draft letters for due items", keywords: "outreach due diligence", href: LOOP_HREF.draft },
  { id: "report-CA", label: "Generate report for CA", keywords: "california naupa file", href: "/reports?state=CA" },
  { id: "report-DE", label: "Generate report for DE", keywords: "delaware naupa file", href: "/reports?state=DE" },
  { id: "report-TX", label: "Generate report for TX", keywords: "texas naupa file", href: "/reports?state=TX" },
  { id: "recovery-search", label: "Run recovery search", keywords: "recoveries claims found money", href: "/recoveries" },
  { id: "cfo-brief", label: "Download CFO brief", keywords: "pdf one page audit committee export summary", download: CFO_BRIEF_HREF },
  { id: "close-pack", label: "Download month-end close pack", keywords: "zip journal roll-forward audit binder activity tie-out auditor ledger export period close", download: CLOSE_PACK_HREF },
  { id: "advance-clock", label: "Advance demo date 30 days", keywords: "clock time simulate fast forward" },
  { id: "toggle-motion", label: "Toggle reduce motion", keywords: "animation accessibility" },
  { id: "start-tour", label: "Take the 3-minute tour", keywords: "judge guided walkthrough demo help", href: TOUR_START_HREF },
  { id: "replay-tour", label: "Replay tour", keywords: "guided walkthrough demo help first run welcome how it works", href: TOUR_START_HREF },
];

export interface GoCommand {
  item: NavItem;
  keys?: readonly string[];
}

export const GO_COMMANDS: readonly GoCommand[] = [...NAV_ITEMS, SETTINGS_ITEM].map((item) => {
  const t = GO_TARGETS.find((g) => g.href === item.href);
  return { item, keys: t ? ["g", t.key] : undefined };
});

/** Case-insensitive substring match over the label and keywords; an empty query matches everything. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export const RECENT_KEY = "es-palette-recent";
export const RECENT_MAX = 5;

/** New recent list with `id` first, deduplicated, at most 5. */
export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}
