"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { isActive, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "./nav-items";

const INDICATOR_SPRING = { type: "spring", stiffness: 500, damping: 40 } as const;

const ITEM_CLASS =
  "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] whitespace-nowrap text-fg-2 transition-colors duration-150 hover:text-fg-1 focus-visible:outline-offset-[-2px]";

function NavLink({
  item,
  pathname,
  onNavigate,
  count,
  layoutGroup,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  count?: number;
  layoutGroup: string;
}) {
  const active = isActive(pathname, item);
  const reduce = useReducedMotion();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(ITEM_CLASS, !active && "hover:bg-ink-2", active && "text-fg-1")}
    >
      {active ? (
        <m.span
          aria-hidden
          layoutId={`${layoutGroup}-active`}
          transition={reduce ? { duration: 0 } : INDICATOR_SPRING}
          className="absolute inset-0 rounded-md bg-ink-3"
        />
      ) : null}
      <Icon
        className={cn("relative size-4 shrink-0 text-fg-3 transition-colors duration-150 group-hover:text-fg-2", active && "text-blue-400 group-hover:text-blue-400")}
        strokeWidth={1.5}
        aria-hidden
      />
      <span className="relative">{item.label}</span>
      {count && count > 0 ? (
        <span className="num relative ml-auto text-xs font-medium text-pink-400" title={`${count} waiting for your approval`}>
          {count}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </Link>
  );
}

/** Grouped nav. `counts` maps an href to a number shown on the right in pink (it needs you). */
export function SideNav({
  onNavigate,
  className,
  counts,
  layoutGroup = "nav",
}: {
  onNavigate?: () => void;
  className?: string;
  counts?: Record<string, number>;
  layoutGroup?: string;
}) {
  const pathname = usePathname();
  return (
    <LazyMotion features={domAnimation} strict>
      <nav aria-label="Main navigation" className={cn("flex h-full flex-col", className)}>
        <div className="space-y-5">
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="mb-1 px-2.5 text-xs text-fg-3">{g.label}</div>
              <div className="flex flex-col gap-px">
                {g.items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} count={counts?.[item.href]} layoutGroup={layoutGroup} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-px pt-4">
          <NavLink item={SETTINGS_ITEM} pathname={pathname} onNavigate={onNavigate} layoutGroup={layoutGroup} />
          <form action={logout}>
            <button type="submit" className={cn(ITEM_CLASS, "w-full hover:bg-ink-2")}>
              <LogOut className="size-4 shrink-0 text-fg-3 group-hover:text-fg-2" strokeWidth={1.5} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </nav>
    </LazyMotion>
  );
}
