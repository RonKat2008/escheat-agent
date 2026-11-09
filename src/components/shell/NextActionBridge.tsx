import { loadLoopData } from "./loop-data";
import { NextActionRunner } from "./NextActionRunner";

/**
 * Server: feeds the shell's `.` shortcut with the live next best action on EVERY page, including pages that draw no
 * Core loop strip (Ask mode, the dashboard's closed "More detail" fold). Render inside Suspense; renders no markup.
 */
export async function NextActionBridge() {
  const d = await loadLoopData();
  return <NextActionRunner href={d.next.href} />;
}
