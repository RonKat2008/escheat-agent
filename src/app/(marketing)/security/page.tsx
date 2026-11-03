import type { Metadata } from "next";
import { DemoButton, GhostButton } from "@/components/marketing/Cta";
import { GateExplainer } from "@/components/marketing/GateExplainer";
import { HonestLimits, RuleProvenance } from "@/components/marketing/Proof";
import { SectionHead } from "@/components/marketing/SectionHead";

export const metadata: Metadata = {
  title: "Security",
  description: "The model never decides the law, every rule has a source, and a person approves every irreversible step.",
  alternates: { canonical: "/security" },
  openGraph: { title: "Security at Escheat Agent", description: "Sourced rules, payload-bound approvals, test-mode outreach, replica portals only." },
};

const GUARANTEES = [
  {
    title: "The model never decides the law",
    body: "Models classify payees and research sources. Dormancy periods, thresholds, due-diligence windows and every legal date are computed by deterministic code from versioned rule files. The owner's state is re-derived in code and overrides the model.",
  },
  {
    title: "Every rule value has a receipt",
    body: "Each value links to an official source with a quote and a retrieval date, plus a verified flag. Unverified values show an UNVERIFIED badge everywhere they are used. Where nothing is sourced, the engine says UNKNOWN.",
  },
  {
    title: "Approvals are bound to what you saw",
    body: "Mailing, emailing, calling, submitting a report, filing a claim and applying a rule change each need an in-app approval. It is checked on the server, tied to the hash of the exact payload, single-use and time-limited. The MCP server can draft but cannot approve.",
  },
  {
    title: "Test mode and allowlists",
    body: "Letters go through Lob test mode and the code refuses a live key. Email goes only to allowlisted addresses and calls only to allowlisted numbers, one recipient at a time.",
  },
  {
    title: "Replica portals only",
    body: "The filing and recovery agents run against replica state portals inside this repo. Code refuses any other URL, so this prototype never files with or searches a real state.",
  },
  {
    title: "An evidence pack for auditors",
    body: "Each report ships with a validated NAUPA II file and a PDF evidence pack. The audit trail records what was sent, to whom, when and who approved it.",
  },
  {
    title: "Honest when something is missing",
    body: "If a key is not configured the feature says so or uses a clearly labeled fallback. It never fakes a result to look like it works.",
  },
  {
    title: "Closed by default",
    body: "The app sits behind a passcode gate that fails closed in production, with CSRF checks on state-changing requests. This public site shows static copy only: no database reads, no company data.",
  },
] as const;

export default function SecurityPage() {
  return (
    <>
      <section className="mkt-page-head" aria-labelledby="sec-heading">
        <div className="mkt-wrap">
          <p className="mkt-label">Security</p>
          <h1 id="sec-heading" className="mkt-h1 mkt-h1-page">
            The agent does the work. The law is code. You <span className="mkt-accent mkt-accent-human">sign off.</span>
          </h1>
          <p className="mkt-lede">
            Compliance is the wrong place for an agent that improvises. These are the guardrails Escheat Agent is built around, and each one is enforced in
            code, not in a prompt.
          </p>
        </div>
      </section>

      <section className="mkt-section mkt-section-tight" aria-labelledby="guards-heading">
        <div className="mkt-wrap">
          <h2 id="guards-heading" className="sr-only">
            Guarantees
          </h2>
          <ol className="guards">
            {GUARANTEES.map((g, i) => (
              <li key={g.title}>
                <span className="guards-n" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3>{g.title}</h3>
                <p>{g.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="see-gate">
        <div className="mkt-wrap">
          <SectionHead id="see-gate" eyebrow="The approval gate" title="Bound to exactly what you" accent="saw." human />
          <GateExplainer />
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="see-rule">
        <div className="mkt-wrap mkt-two mkt-two-top">
          <SectionHead
            id="see-rule"
            eyebrow="Every rule has a receipt"
            title="Read the"
            accent="source."
            lede="This entry is rendered from the rule file the engine runs on. It stays UNVERIFIED until a person approves it."
          />
          <RuleProvenance state="DE" />
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="not-heading">
        <div className="mkt-wrap mkt-two">
          <SectionHead id="not-heading" eyebrow="Honest limits" title="What this prototype" accent="is not." lede="It is not legal advice, and it has not filed anything with a real state. Confirm filings with a qualified professional." />
          <HonestLimits />
        </div>
      </section>

      <section className="mkt-final" aria-labelledby="sec-final">
        <div className="mkt-wrap">
          <h2 id="sec-final" className="mkt-h2">
            Read the <span className="mkt-accent">receipts</span> yourself.
          </h2>
          <p className="mkt-body">Open the demo and click any date on any item. You will see the rule, its version and its source.</p>
          <div className="mkt-actions mkt-actions-center">
            <DemoButton />
            <GhostButton href="/how-it-works">See how it works</GhostButton>
          </div>
        </div>
      </section>
    </>
  );
}
