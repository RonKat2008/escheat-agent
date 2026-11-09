/**
 * The two modes (docs/ASK-MODE.md §1.3). Pure, no DOM and no React: the mode comes from the pathname only (no cookie,
 * no query flag), so every existing URL keeps its meaning. `/ask` and `/ask/*` are Ask; everything else is Dashboard.
 */
export type AppMode = "ask" | "dashboard";

export const ASK_HREF = "/ask";
export const DASHBOARD_HREF = "/dashboard";
/** sessionStorage key for the last Dashboard-mode path (with its query), so the switch returns where you were. */
export const LAST_DASHBOARD_KEY = "es-last-dashboard";

export function modeOf(pathname: string): AppMode {
  const path = pathname.split(/[?#]/)[0] ?? "";
  return path === ASK_HREF || path.startsWith(`${ASK_HREF}/`) ? "ask" : "dashboard";
}

/** A stored path is used only when it is a same-site relative Dashboard-mode path (never //host, never Ask itself). */
export function safeDashboardPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DASHBOARD_HREF;
  return modeOf(value) === "dashboard" ? value : DASHBOARD_HREF;
}

/** Minimal storage shape (sessionStorage in the browser; a stub in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type StorageAccessor = () => StorageLike | null | undefined;

/** The last Dashboard-mode path, or `/dashboard` when there is none or storage throws (private mode, blocked). */
export function readLastDashboard(storage: StorageAccessor): string {
  try {
    return safeDashboardPath(storage()?.getItem(LAST_DASHBOARD_KEY));
  } catch {
    return DASHBOARD_HREF;
  }
}

/** Remembers a Dashboard-mode path. Ask paths are ignored; a storage failure is harmless (the fallback is /dashboard). */
export function writeLastDashboard(storage: StorageAccessor, path: string): void {
  if (modeOf(path) !== "dashboard") return;
  try {
    storage()?.setItem(LAST_DASHBOARD_KEY, safeDashboardPath(path));
  } catch {
    /* storage blocked: the switch falls back to /dashboard */
  }
}

/** Where the mode toggle (mod+/) goes from `pathname`: Ask from any Dashboard page, the last Dashboard page from Ask. */
export function toggleTarget(pathname: string, lastDashboard: string): string {
  return modeOf(pathname) === "ask" ? safeDashboardPath(lastDashboard) : ASK_HREF;
}

/** Browser sessionStorage, or null on the server. Reading it can throw, so callers go through readLastDashboard. */
export const browserSession = (): StorageLike | null => (typeof window === "undefined" ? null : window.sessionStorage);
