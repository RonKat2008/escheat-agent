"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SHELL_EVENTS } from "./useShortcuts";
import { markNavigationTo } from "./nav-hold";

/** Runs the next best action when the shell's `.` shortcut fires. Independent of whether the loop strip is mounted. */
export function NextActionRunner({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const run = () => {
      markNavigationTo(href);
      router.push(href);
    };
    window.addEventListener(SHELL_EVENTS.runNextAction, run);
    return () => window.removeEventListener(SHELL_EVENTS.runNextAction, run);
  }, [router, href]);
  return null;
}
