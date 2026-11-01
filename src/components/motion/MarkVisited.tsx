"use client";

import { useEffect } from "react";
import { readCookie, seenCookie, SEEN_COOKIE } from "./seen";

/** Records that page `id` has been shown this session, so the server skips its first-load stagger next time. */
export function MarkVisited({ id }: { id: string }) {
  useEffect(() => {
    document.cookie = seenCookie(readCookie(document.cookie, SEEN_COOKIE), id);
  }, [id]);
  return null;
}
