import {
  Activity,
  BadgeCheck,
  BookOpenCheck,
  FileText,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  PiggyBank,
  Plug,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** extra path prefixes that mark this item active */
  match?: string[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/"] },
  { href: "/items", label: "Items", icon: Inbox },
  { href: "/approvals", label: "Approvals", icon: BadgeCheck },
  { href: "/rules", label: "Rules", icon: BookOpenCheck },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/recoveries", label: "Recoveries", icon: PiggyBank },
  { href: "/runs", label: "Agent runs", icon: Activity },
  { href: "/eval", label: "Eval", icon: FlaskConical },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings/integrations", label: "Settings", icon: Plug, match: ["/settings"] };

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.match?.includes(pathname)) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || Boolean(item.match?.some((m) => m !== "/" && pathname.startsWith(m)));
}
