import type { Metadata } from "next";
import { DemoButton, GhostButton } from "@/components/marketing/Cta";
import { GateExplainer } from "@/components/marketing/GateExplainer";
import { LifecycleExplainer } from "@/components/marketing/LifecycleExplainer";
import { RuleProvenance } from "@/components/marketing/Proof";
import { SectionHead } from "@/components/marketing/SectionHead";
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
          <p className="mkt-label">How it works</p>
          <h1 id="hiw-heading" className="mkt-h1 mkt-h1-page">
            How a stale check becomes a filed <span className="mkt-accent">report.</span>
          </h1>
          <p className="mkt-lede">
            Escheat Agent runs the whole chore, from reading your ledger to recovering money owed back to you. Each step lists what the agent does, what stays
            with you, and the evidence it leaves behind. Blue runs on its own; pink waits for a person.
          </p>
        </div>
      </section>

      <section className="mkt-section mkt-section-tight" aria-label="The six steps">
        <div className="mkt-wrap">
          <ol className="deep">
            {STEPS.map((s, i) => (
              <li key={s.id} id={s.id} data-actor={s.actor} className="deep-step">
                <div className="deep-rail" aria-hidden>
                  <span className="deep-n">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <div className="deep-body">
                  <header>
                    <h2 className="deep-title">{s.title}</h2>
                    <span className={`mkt-chip ${s.actor === "you" ? "mkt-chip-human" : "mkt-chip-agent"}`}>
                      <span aria-hidden className="mkt-chip-shape" />
                      {s.actorNote}
                    </span>
                  </header>
                  <p className="deep-short">{s.short}</p>
                  <dl className="deep-cols">
                    <div>
                      <dt>What the agent does</dt>
                      <dd>{s.agent}</dd>
                    </div>
                    <div>
                      <dt>What stays with you</dt>
                      <dd>{s.stays}</dd>
                    </div>
                    <div>
                      <dt>What it leaves behind</dt>
                      <dd>{s.leaves}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="hiw-clock">
        <div className="mkt-wrap">
          <SectionHead id="hiw-clock" eyebrow="Step 3 in detail" title="Every date comes from a" accent="rule file." lede="The legal lifecycle of an uncashed vendor check in each state, quoted from the files the engine runs on." />
          <LifecycleExplainer />
          <div className="mkt-two mkt-two-top hiw-prov">
            <div>
              <h3 className="mkt-h3">Value, rule path, source</h3>
              <p className="mkt-body">
                Click any date in the demo and you get this chain. A model never fills in a missing value: no source means UNKNOWN, and every date that
                depends on it says so.
              </p>
            </div>
            <RuleProvenance state="TX" />
          </div>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="hiw-gate">
        <div className="mkt-wrap">
          <SectionHead id="hiw-gate" eyebrow="Steps 4 to 6" title="Where a person" accent="signs off." human />
          <GateExplainer />
        </div>
      </section>

      <section className="mkt-final" aria-labelledby="hiw-final">
        <div className="mkt-wrap">
          <h2 id="hiw-final" className="mkt-h2">
            Watch one check go all the way <span className="mkt-accent">through.</span>
          </h2>
          <p className="mkt-body">The demo follows check #10482, a synthetic $2,340.00 payment to Bayline Electric, from stale to filed.</p>
          <div className="mkt-actions mkt-actions-center">
            <DemoButton />
            <GhostButton href="/security">Security</GhostButton>
          </div>
        </div>
      </section>
    </>
  );
}
