/**
 * R10-10: after the demo clock is moved back, stored records (Activity rows, the Horizon prediction check) can carry
 * demo dates later than "today". They are honest history, not forecasts; this names them so nobody reads them as one.
 * Pure. Dates are YYYY-MM-DD, compared as strings.
 */
export function isAfterDemoClock(day: string | null | undefined, today: string): boolean {
  return Boolean(day) && /^\d{4}-\d{2}-\d{2}$/.test(day as string) && (day as string) > today;
}

export const AFTER_CLOCK_LABEL = "Recorded after the demo clock";
export const AFTER_CLOCK_HINT = "The demo clock was moved back; this record was made at a later clock position and is history, not a forecast.";
