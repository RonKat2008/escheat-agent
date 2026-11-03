"use client";

import { useEffect, useState, type ComponentType } from "react";
import { afterLoadIdle } from "@/components/motion/idle";
import { toastOutletMounted } from "@/lib/toast";
import type { ToasterProps } from "sonner";

/** Mounts the sonner <Toaster /> after the page has loaded, keeping it out of the first-load bundle. */
export function ToastOutlet() {
  const [Toaster, setToaster] = useState<ComponentType<ToasterProps> | null>(null);
  useEffect(() => {
    let live = true;
    void afterLoadIdle()
      .then(() => import("@/components/ui/sonner"))
      .then((m) => {
        if (live) setToaster(() => m.Toaster);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (Toaster) toastOutletMounted();
  }, [Toaster]);
  return Toaster ? <Toaster theme="dark" /> : null;
}
