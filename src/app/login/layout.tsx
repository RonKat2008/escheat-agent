import "./login.css";

/* Two families only (§1.3): the editorial accent is weight + blue-300, so no display font is loaded here. */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-ink-0">{children}</div>;
}
