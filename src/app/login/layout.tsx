import { Instrument_Serif } from "next/font/google";

/* Same editorial accent as the marketing site: one Instrument Serif italic phrase in the headline. */
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400", style: ["italic"], display: "swap" });

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={`min-h-screen bg-ink-0 ${display.variable}`}>{children}</div>;
}
