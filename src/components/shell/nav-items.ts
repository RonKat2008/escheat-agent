import {
  Activity,
  BadgeCheck,
  BookOpenCheck,
  FileText,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  PiggyBank,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/items", label: "Items", icon: Inbox },
  { href: "/approvals", label: "Approvals", icon: BadgeCheck },
  { href: "/rules", label: "Rules", icon: BookOpenCheck },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/recoveries", label: "Recoveries", icon: PiggyBank },
  { href: "/runs", label: "Agent runs", icon: Activity },
  { href: "/eval", label: "Eval", icon: FlaskConical },
];
