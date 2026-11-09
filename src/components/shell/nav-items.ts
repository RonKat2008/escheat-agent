import {
  Activity,
  Clapperboard,
  BadgeCheck,
  BookOpenCheck,
  CalendarRange,
  FileText,
  FlaskConical,
  FlaskRound,
  History,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  PiggyBank,
  Radar,
  Scale,
  ShieldCheck,
  Plug,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** extra path prefixes that mark this item active */
  match?: string[];
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/"] },
      { href: "/items", label: "Items", icon: Inbox },
      { href: "/payees", label: "Payees", icon: Users },
      { href: "/approvals", label: "Approvals", icon: BadgeCheck },
      { href: "/forecast", label: "Forecast", icon: CalendarRange },
      { href: "/horizon", label: "Horizon", icon: Radar },
      { href: "/what-if", label: "What-if", icon: FlaskRound },
      { href: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    label: "Books",
    items: [
      { href: "/ledger", label: "Ledger", icon: Scale },
      { href: "/audit", label: "Audit drill", icon: ShieldCheck },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/rules", label: "Rules", icon: BookOpenCheck },
      { href: "/reports", label: "Reports", icon: FileText, match: ["/close-out"] },
      { href: "/recoveries", label: "Recoveries", icon: PiggyBank },
    ],
  },
  {
    label: "Agents",
    items: [
      { href: "/chat", label: "Chat", icon: MessagesSquare },
      { href: "/runs", label: "Agent runs", icon: Activity },
      { href: "/theater", label: "Watch it work", icon: Clapperboard },
      { href: "/eval", label: "Eval", icon: FlaskConical },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const SETTINGS_ITEM: NavItem = { href: "/settings/integrations", label: "Settings", icon: Plug, match: ["/settings"] };

/**
 * V4 pill nav (docs/DESIGN-V4.md §5): the top-level sections in the centred glass capsule. Each opens its first page;
 * the sidebar rail keeps every individual page. `match` lists the path prefixes that mark a section active, and every
 * NAV_ITEMS / SETTINGS_ITEM href belongs to exactly one section (nav-items.test.ts).
 */
export interface NavSection {
  id: string;
  label: string;
  href: string;
  match: readonly string[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  { id: "overview", label: "Overview", href: "/dashboard", match: ["/dashboard"] },
  { id: "work", label: "Work", href: "/items", match: ["/items", "/payees", "/forecast", "/horizon", "/what-if", "/activity"] },
  { id: "approvals", label: "Approvals", href: "/approvals", match: ["/approvals"] },
  { id: "books", label: "Books", href: "/ledger", match: ["/ledger", "/audit"] },
  { id: "setup", label: "Setup", href: "/rules", match: ["/rules", "/reports", "/close-out", "/recoveries", "/settings"] },
  { id: "agents", label: "Agents", href: "/runs", match: ["/chat", "/runs", "/theater", "/eval"] },
];

/** The section a path belongs to, or null (the root path counts as Overview). */
export function activeSection(pathname: string): NavSection | null {
  if (pathname === "/") return NAV_SECTIONS[0] ?? null;
  return NAV_SECTIONS.find((s) => s.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))) ?? null;
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.match?.includes(pathname)) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || Boolean(item.match?.some((m) => m !== "/" && pathname.startsWith(m)));
}
