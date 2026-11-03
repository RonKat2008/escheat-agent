"use client";

import { usePathname } from "next/navigation";
import { isActive, NAV_GROUPS, SETTINGS_ITEM } from "./nav-items";

/** Top-bar breadcrumb: nav group, then the current page (§6.0). Derived from the nav list, never typed per page. */
export function Breadcrumb() {
  const pathname = usePathname();
  const group = NAV_GROUPS.find((g) => g.items.some((i) => isActive(pathname, i)));
  const item = group?.items.find((i) => isActive(pathname, i)) ?? (isActive(pathname, SETTINGS_ITEM) ? SETTINGS_ITEM : null);
  if (!item) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink-0 items-center xl:flex">
      <ol className="flex items-center gap-1.5 text-[13px]">
        <li className="instrument-label">{group?.label ?? "Setup"}</li>
        <li aria-hidden className="text-fg-4">
          /
        </li>
        <li aria-current="page" className="truncate font-medium text-fg-1">
          {item.label}
        </li>
      </ol>
    </nav>
  );
}
