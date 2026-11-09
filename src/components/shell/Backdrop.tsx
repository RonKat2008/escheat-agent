/**
 * The V4 atmosphere (docs/DESIGN-V4.md §2): a fixed navy backdrop with a coral bloom, a steel haze and a vignette, with
 * the ribbed-glass texture over it. Pure CSS gradients (globals.css .es-backdrop / .es-ribbed); decorative only, so it
 * is hidden from assistive tech and never takes pointer events. It sits behind content (z-index -1), so the texture can
 * never lower text contrast.
 */
export function Backdrop() {
  return (
    <div aria-hidden data-testid="app-backdrop" className="es-backdrop">
      <div data-testid="ribbed-glass" aria-hidden className="es-ribbed" />
    </div>
  );
}
