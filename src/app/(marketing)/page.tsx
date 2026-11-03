import type { Metadata } from "next";
import Link from "next/link";
import { DemoButton, GhostButton } from "@/components/marketing/Cta";
import { GateExplainer } from "@/components/marketing/GateExplainer";
import { HeroVault } from "@/components/marketing/HeroVault";
import { LifecycleExplainer } from "@/components/marketing/LifecycleExplainer";
import { HonestLimits, ProofGrid } from "@/components/marketing/Proof";
import { SectionHead } from "@/components/marketing/SectionHead";
import { VaultSteps } from "@/components/marketing/VaultSteps";
import { InView } from "@/components/motion/InView";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Synthetic demo invariants (README "Running the demo"; fixtures/synthetic/README.md; fixtures/eval). */
const PROOF_LINE = [
  { value: "47", label: "stale items" },
  { value: "$61,915.00", label: "exposure" },
  { value: "CA 21 · TX 15 · DE 11", label: "by owner state" },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="vx" aria-labelledby="hero-heading">
        <div className="vx-grid mkt-wrap">
          <header className="vx-hero">
            <p className="mkt-label vx-eyebrow">Unclaimed-property compliance agent · CA · DE · TX</p>
            <h1 id="hero-heading" className="mkt-h1">
              <span className="vx-line" style={{ "--d": 0 } as React.CSSProperties}>
                Every uncashed
              </span>{" "}
              <span className="vx-line" style={{ "--d": 1 } as React.CSSProperties}>
                check is a
              </span>{" "}
              <span className="vx-line mkt-accent" style={{ "--d": 2 } as React.CSSProperties}>
                legal clock.
              </span>
            </h1>
            <p className="mkt-lede vx-rise" style={{ "--d": 3 } as React.CSSProperties}>
              Escheat Agent reads your ledger, applies each state&apos;s sourced rules, reaches the owner and files the report. It stops for your approval
              before anything that can&apos;t be undone.
            </p>
            <div className="mkt-actions vx-rise" style={{ "--d": 4 } as React.CSSProperties}>
              <DemoButton />
              <GhostButton href="/how-it-works">See how it works</GhostButton>
            </div>
            <div className="vx-proof vx-rise" style={{ "--d": 5 } as React.CSSProperties}>
              <dl aria-label="The synthetic demo company, by the numbers">
                {PROOF_LINE.map((p) => (
                  <div key={p.label}>
                    <dt>{p.label}</dt>
                    <dd className="num">{p.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="vx-proof-note">
                <span className="mkt-synth">Synthetic data</span> Northwind Fixtures, Inc., a generated demo company.
              </p>
            </div>
          </header>

          <div className="vx-visual">
            <div className="vx-sticky">
              <HeroVault />
            </div>
          </div>

          <div className="vx-story" id="how">
            <SectionHead id="how-heading" eyebrow="How it works" title="From a ledger export to a filed report." accent="Blue runs on its own. Pink waits for you." />
            <VaultSteps />
            <p className="vx-more">
              <Link href="/how-it-works" className="mkt-textlink">
                Every step in detail
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="clock-heading">
        <div className="mkt-wrap">
          <SectionHead
            id="clock-heading"
            eyebrow="The problem"
            title="Your books say outstanding. The state says"
            accent="abandoned."
            lede="After a dormancy period an uncashed check stops being a payable and becomes property you hold for the state. Each state keeps its own clock. These are the values the engine runs on, quoted from its rule files."
          />
          <InView className="mkt-rv">
            <LifecycleExplainer />
          </InView>
          <p className="mkt-fine">Vendor checks. Labels only, not to scale. Every value stays UNVERIFIED until a person approves it in the app.</p>
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="gate-heading">
        <div className="mkt-wrap">
          <SectionHead
            id="gate-heading"
            eyebrow="The human gate"
            title="Nothing leaves"
            accent="without you."
            lede="Autonomous up to the point it can't be undone. Every irreversible action pauses for an in-app approval that is enforced on the server."
            human
          />
          <GateExplainer />
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="proof-heading">
        <div className="mkt-wrap">
          <SectionHead id="proof-heading" eyebrow="Proof" title="Receipts, not" accent="promises." lede="Four things you can check in the demo yourself." />
          <ProofGrid />
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="limits-heading">
        <div className="mkt-wrap mkt-two">
          <SectionHead id="limits-heading" eyebrow="Honest limits" title="What this prototype" accent="is not." lede="It is not legal advice, and it has never filed with a real state." />
          <HonestLimits />
        </div>
      </section>

      <section className="mkt-final" aria-labelledby="final-heading">
        <div className="mkt-wrap">
          <h2 id="final-heading" className="mkt-h2">
            See what a ledger owes the <span className="mkt-accent">states.</span>
          </h2>
          <p className="mkt-body">The demo runs a synthetic company end to end: stale checks, letters, a filing that pauses for you, and money found back.</p>
          <div className="mkt-actions mkt-actions-center">
            <DemoButton />
            <GhostButton href="/security">Why you can trust it</GhostButton>
          </div>
        </div>
      </section>
    </>
  );
}
