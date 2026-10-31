/**
 * Section heading that rises out of a mask as it enters the viewport. Pure CSS (scroll-driven animation, see
 * marketing-sections.css): visible by default, and browsers without scroll timelines or with reduced motion just show it.
 */
export function RevealHeading({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className={`mkt-display mkt-reveal ${className}`}>
      <span className="mkt-reveal-inner">{children}</span>
    </h2>
  );
}
