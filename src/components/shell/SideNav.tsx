"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex flex-row gap-1 overflow-x-auto md:flex-col">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href === "/dashboard" && pathname === "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active && "bg-accent text-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-at-risk")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
