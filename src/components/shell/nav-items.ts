import {
  Activity,
  BadgeCheck,
  BookOpenCheck,
  CalendarRange,
  FileText,
  FlaskConical,
  History,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  PiggyBank,
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
      { href: "/activity", label: "Activity", icon: History },
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
      { href: "/eval", label: "Eval", icon: FlaskConical },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const SETTINGS_ITEM: NavItem = { href: "/settings/integrations", label: "Settings", icon: Plug, match: ["/settings"] };

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.match?.includes(pathname)) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || Boolean(item.match?.some((m) => m !== "/" && pathname.startsWith(m)));
}
