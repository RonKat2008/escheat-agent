/**
 * Where the toaster sits. While the guided tour is open its narration (a bottom sheet on phones, a floating card on
 * wide screens) must never be covered by a toast, so the toaster moves out of its way (R8-11).
 */
export interface TourToastInset {
  /** Narration is a bottom sheet (viewport < 640px) rather than a floating card. */
  sheet: boolean;
  /** Height of the sheet in px (ignored for the floating card). */
  sheetHeight: number;
}

interface Edges {
  bottom: number;
  left: number;
  right: number;
}

export interface ToastLayout {
  position: "bottom-right" | "bottom-left";
  offset: Edges;
  mobileOffset: Edges;
}

const EDGE = 16;
/** Air between a toast and the sheet it sits above. */
const SHEET_GAP = 12;

export function toastLayout(tour: TourToastInset | null): ToastLayout {
  if (!tour) {
    const o = { bottom: EDGE, left: EDGE, right: EDGE };
    return { position: "bottom-right", offset: o, mobileOffset: o };
  }
  // Sheet: above it. Card: the bottom-left corner, which the card (placed beside its target, in the main area) rarely reaches.
  const bottom = tour.sheet ? Math.ceil(tour.sheetHeight) + SHEET_GAP : EDGE;
  const o = { bottom, left: EDGE, right: EDGE };
  return { position: tour.sheet ? "bottom-right" : "bottom-left", offset: o, mobileOffset: o };
}

let current: TourToastInset | null = null;
const listeners = new Set<() => void>();

export function subscribeTourToastInset(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getTourToastInset = (): TourToastInset | null => current;

/** The tour reports its sheet (or null when it closes). Only emits when something changed. */
export function setTourToastInset(next: TourToastInset | null): void {
  const same = current === next || (current && next && current.sheet === next.sheet && Math.abs(current.sheetHeight - next.sheetHeight) < 1);
  if (same) return;
  current = next;
  listeners.forEach((l) => l());
}
