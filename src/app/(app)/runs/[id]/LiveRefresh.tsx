"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a run is active, re-reads the server data every 2 seconds so new steps stream in. */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
