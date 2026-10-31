"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Trust and safety" },
] as const;

/** Menu for phone widths, where the inline nav links are hidden. Escape and any link press close it. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="mkt-menu">
      <button type="button" className="mkt-menu-btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className="mkt-menu-icon" aria-hidden data-open={open} />
        <span className="mkt-sr">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <nav id={panelId} aria-label="Mobile navigation" className="mkt-menu-panel" hidden={!open}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
