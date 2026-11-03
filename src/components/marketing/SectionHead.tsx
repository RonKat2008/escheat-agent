import { InView } from "@/components/motion/InView";

interface SectionHeadProps {
  id: string;
  eyebrow: string;
  title: string;
  /** The emphasized words: weight 300 in blue-300 (or pink-400 when the section is about a human step). */
  accent?: string;
  lede?: string;
  human?: boolean;
}

/** Instrument-label eyebrow, a large h2 with a weight-contrast accent, an optional lede. Reveals once in view. */
export function SectionHead({ id, eyebrow, title, accent, lede, human }: SectionHeadProps) {
  return (
    <InView className="mkt-head mkt-rv">
      <p className={`mkt-label ${human ? "mkt-label-human" : ""}`}>{eyebrow}</p>
      <h2 id={id} className="mkt-h2">
        {title} {accent ? <span className={human ? "mkt-accent mkt-accent-human" : "mkt-accent"}>{accent}</span> : null}
      </h2>
      {lede ? <p className="mkt-body">{lede}</p> : null}
    </InView>
  );
}
