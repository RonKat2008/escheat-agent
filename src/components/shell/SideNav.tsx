"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS, SETTINGS_ITEM, type NavItem } from "./nav-items";

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-150",
        "hover:bg-raised/70 hover:text-foreground focus-visible:outline-offset-[-2px] active:scale-[0.99]",
        active && "bg-bolt/10 text-foreground shadow-[inset_0_0_0_1px_rgb(47_168_255/0.18)] hover:bg-bolt/10",
      )}
    >
      {active ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-bolt shadow-[0_0_10px_var(--es-bolt-glow)]" /> : null}
      <Icon className={cn("size-4 shrink-0", active && "text-bolt-strong")} aria-hidden />
      {item.label}
    </Link>
  );
}

export function SideNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className={cn("flex h-full flex-col gap-0.5", className)}>
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
      <div className="mt-auto border-t border-border pt-2">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} onNavigate={onNavigate} />
        <form action={logout}>
          <button
            type="submit"
            className="flex h-9 w-full items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-raised/70 hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
