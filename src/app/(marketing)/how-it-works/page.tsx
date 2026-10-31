import type { Metadata } from "next";
import { RevealHeading } from "@/components/marketing/RevealHeading";
import { DemoButton, GhostButton } from "@/components/marketing/Cta";
import { STEPS } from "@/components/marketing/steps";

export const metadata: Metadata = {
  title: "How it works",
  description: "Six steps from a ledger export to a filed unclaimed-property report, and exactly where a person approves.",
  alternates: { canonical: "/how-it-works" },
  openGraph: { title: "How Escheat Agent works", description: "Six steps from a ledger export to a filed report, with a human approval at every irreversible step." },
};

export default function HowItWorksPage() {
  return (
    <>
      <section className="mkt-page-head" aria-labelledby="hiw-heading">
        <div className="mkt-wrap">
          <h1 id="hiw-heading" className="mkt-display mkt-h1 mkt-h1-page">
            How a stale check becomes a filed <em className="mkt-accent">report.</em>
          </h1>
          <p className="mkt-lede">
            Escheat Agent runs the whole chore, from reading your ledger to recovering money owed back to you. Each step lists what the agent does, what stays with
            you, and the evidence it leaves behind.
          </p>
        </div>
      </section>

      <section className="mkt-section" aria-label="The six steps">
        <div className="mkt-wrap">
          <ol className="mkt-deep">
            {STEPS.map((s, i) => (
              <li key={s.id} id={s.id} data-actor={s.actor}>
                <header>
                  <span className="mkt-step-n">{i + 1}</span>
                  <RevealHeading className="mkt-h3">{s.title}</RevealHeading>
                  <span className={`mkt-chip ${s.actor === "you" ? "mkt-chip-human" : "mkt-chip-agent"}`}>{s.actorNote}</span>
                </header>
                <div className="mkt-deep-cols">
                  <div>
                    <h3>What the agent does</h3>
                    <p>{s.agent}</p>
                  </div>
                  <div>
                    <h3>What stays with you</h3>
                    <p>{s.stays}</p>
                  </div>
                  <div>
                    <h3>What it leaves behind</h3>
                    <p>{s.leaves}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mkt-final" aria-labelledby="hiw-final">
        <div className="mkt-wrap">
          <RevealHeading id="hiw-final" className="mkt-h2 mkt-final-h">
            Watch one check go all the way <em className="mkt-accent">through.</em>
          </RevealHeading>
          <p className="mkt-body">The demo follows check #10482, a synthetic $2,340.00 payment to Bayline Electric, from stale to filed.</p>
          <div className="mkt-actions mkt-actions-center">
            <DemoButton />
            <GhostButton href="/security">Trust and safety</GhostButton>
          </div>
        </div>
      </section>
    </>
  );
}
