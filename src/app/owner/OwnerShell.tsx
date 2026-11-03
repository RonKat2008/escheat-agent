import type { ReactNode } from "react";
import { DISCLAIMER } from "@/lib/disclaimer";

export const REASON_COPY: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This link has expired",
    body: "For your security these links stop working after a while. Please contact the company that sent you the notice and they can send a new one.",
  },
  already_used: {
    title: "This link was already used",
    body: "We already received a response through this link, so it can't be used again. If something changed, please contact the company that sent you the notice.",
  },
  not_live: {
    title: "This link isn't active yet",
    body: "This link starts working once the company has actually sent you the notice. If you received a letter or email with this link, please contact the company that sent it.",
  },
  invalid: {
    title: "We couldn't open this link",
    body: "The link looks incomplete or incorrect. Please check that you copied the whole address, or contact the company that sent you the notice.",
  },
};

/**
 * The owner page frame (DESIGN-V3 §6.17): a plain centred 560px column on black, no app shell. It renders the
 * disclaimer exactly once, so pages put it OUTSIDE any Suspense boundary (a streamed fallback would duplicate it).
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="owner-col">
      <span className="owner-tag">Prototype · synthetic data</span>
      {children}
      <footer className="owner-foot">
        <p>{DISCLAIMER}</p>
      </footer>
    </main>
  );
}

/** A plain explanation (link errors, unavailable page). No 3D, no jargon. Content only: wrap it in <Shell>. */
export function NoticeBody({ title, body }: { title: string; body: string }) {
  return (
    <section className="owner-card owner-notice" aria-labelledby="owner-notice-title">
      <h1 id="owner-notice-title" className="owner-h1">
        {title}
      </h1>
      <p className="owner-lede">{body}</p>
      <p className="owner-help">If you were not expecting a notice like this, you can ignore it. Nothing happens to your money because of this page.</p>
    </section>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <NoticeBody title={title} body={body} />
    </Shell>
  );
}
