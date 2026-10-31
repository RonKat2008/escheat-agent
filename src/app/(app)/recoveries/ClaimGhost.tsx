/** Ghosted claim rows shown when nothing has been found yet. Decorative: describes what results will look like. */
export function ClaimGhost() {
  return (
    <ul aria-hidden className="space-y-3 select-none" data-testid="claim-ghost">
      {[0, 1].map((i) => (
        <li key={i} className="rounded-xl border border-line p-5" style={{ opacity: i === 0 ? 0.7 : 0.4 }}>
          <div className="flex items-center justify-between gap-4">
            <span className="h-2.5 w-24 rounded-full bg-ink-3" />
            <span className="h-5 w-28 rounded-md bg-ink-3" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <span className="h-2.5 w-3/4 rounded-full bg-ink-3" />
            <span className="h-2.5 w-2/3 rounded-full bg-ink-3" />
          </div>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-1 w-40 rounded-full bg-ink-3" />
            <span className="h-2.5 w-8 rounded-full bg-ink-3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
