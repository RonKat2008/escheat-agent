/**
 * The tour's URL contract, kept tiny so the shell can import it without pulling in the tour itself.
 * `?tour=N` is 1-based in the URL (what a person types or shares) and 0-based in code.
 */
export const TOUR_PARAM = "tour";

/** Where "Take the 3-minute tour" starts: stop 1 on the dashboard. */
export const TOUR_START_HREF = `/dashboard?${TOUR_PARAM}=1`;

/**
 * 0-based stop index from the raw `?tour=` value, clamped to the tour's length. Anything that is not a plain positive
 * integer means "no tour" (null), so a stray or hand-typed value never opens it by accident.
 */
export function parseTourParam(raw: string | null | undefined, total: number): number | null {
  if (raw == null || total <= 0) return null;
  const v = raw.trim();
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number.parseInt(v, 10);
  if (n < 1) return null;
  return Math.min(n, total) - 1;
}

/** The same search string without the tour param ("" or "?a=b"). */
export function withoutTourParam(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete(TOUR_PARAM);
  const s = params.toString();
  return s ? `?${s}` : "";
}
