import type { Metadata } from "next";
import { RevealHeading } from "@/components/marketing/RevealHeading";
import { DemoButton, GhostButton } from "@/components/marketing/Cta";
import { ApprovalMock, RuleCard } from "@/components/marketing/Mocks";

export const metadata: Metadata = {
  title: "Trust and safety",
  description: "The model never decides the law, every rule has a source, and a person approves every irreversible step.",
  alternates: { canonical: "/security" },
  openGraph: { title: "Trust and safety at Escheat Agent", description: "Sourced rules, payload-bound approvals, test-mode outreach, replica portals only." },
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
          <h1 id="sec-heading" className="mkt-display mkt-h1 mkt-h1-page">
            The agent does the work. The law is code. You <em className="mkt-accent">sign off.</em>
          </h1>
          <p className="mkt-lede">
            Compliance is the wrong place for an agent that improvises. These are the guardrails Escheat Agent is built around, and each one is enforced in code, not
            in a prompt.
          </p>
        </div>
      </section>

      <section className="mkt-section" aria-label="Guarantees">
        <div className="mkt-wrap">
          <ul className="mkt-guards">
            {GUARANTEES.map((g) => (
              <li key={g.title}>
                <h2>{g.title}</h2>
                <p>{g.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="see-heading">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <RevealHeading id="see-heading" className="mkt-h2">
              What that looks like on <em className="mkt-accent">screen.</em>
            </RevealHeading>
          </div>
          <div className="mkt-two mkt-two-top">
            <RuleCard />
            <ApprovalMock />
          </div>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="not-heading">
        <div className="mkt-wrap">
          <RevealHeading id="not-heading" className="mkt-h2">
            What this prototype is <em className="mkt-accent">not.</em>
          </RevealHeading>
          <p className="mkt-body">
            It is not legal advice, and it has not filed anything with a real state. The rule files cover California, Delaware and Texas, and their values stay
            unverified until a person approves them. Confirm filings with a qualified professional.
          </p>
        </div>
      </section>

      <section className="mkt-final" aria-labelledby="sec-final">
        <div className="mkt-wrap">
          <RevealHeading id="sec-final" className="mkt-h2 mkt-final-h">
            Read the <em className="mkt-accent">receipts</em> yourself.
          </RevealHeading>
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
