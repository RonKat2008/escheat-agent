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
  invalid: {
    title: "We couldn't open this link",
    body: "The link looks incomplete or incorrect. Please check that you copied the whole address, or contact the company that sent you the notice.",
  },
};

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="owner-col">
      <span className="owner-tag">Prototype - synthetic data</span>
      {children}
      <p className="owner-foot">{DISCLAIMER}</p>
    </main>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="owner-h1">{title}</h1>
      <p className="owner-lede">{body}</p>
    </Shell>
  );
}
