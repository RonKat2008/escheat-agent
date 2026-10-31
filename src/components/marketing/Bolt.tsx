/** The lightning mark. Decorative: pair it with visible text. */
export function Bolt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden focusable="false">
      <path d="M13.6 1.5 4.2 13.4h6.1l-1.4 9.1 9.6-12.2h-6.2l1.3-8.8Z" fill="currentColor" />
    </svg>
  );
}
