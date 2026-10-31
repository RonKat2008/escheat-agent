import type { Metadata } from "next";
import Link from "next/link";
import { RevealHeading } from "@/components/marketing/RevealHeading";
import { DemoButton, GhostButton } from "@/components/marketing/Cta";
import { HeroTrace } from "@/components/marketing/HeroTrace";
import { ApprovalMock, ChatMock, RuleCard } from "@/components/marketing/Mocks";
import { ScrollSteps } from "@/components/marketing/ScrollSteps";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const FACTS = [
  {
    title: "The clock starts when the check is issued, not when you notice.",
    body: (
      <>
        After a state&apos;s dormancy period an uncashed check stops being an open payable and becomes presumed-abandoned property your company holds for the
        state. In Texas that is three years for an uncashed check (
        <a href="https://tcss.legis.texas.gov/resources/PR/htm/PR.72.htm" target="_blank" rel="noopener noreferrer">
          Prop. Code ch. 72
        </a>
        ).
      </>
    ),
  },
  {
    title: "Late costs money.",
    body: (
      <>
        California charges interest at <em className="mkt-hot">12 percent per annum</em> from the date property should have been reported, unless the failure is due to reasonable cause (
        <a
          href="https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=1577"
          target="_blank"
          rel="noopener noreferrer"
        >
          CCP section 1577
        </a>
        ).
      </>
    ),
  },
  {
    title: "Every state keeps its own rulebook.",
    body: "Dormancy periods, notice windows, report dates and file formats differ by state. Escheat Agent encodes California, Delaware and Texas today, and answers UNKNOWN for anything it has not sourced.",
  },
  {
    title: "Auditors ask for evidence, not intentions.",
    body: "Who was notified, with what text, when, and who signed off. Today that lives in a spreadsheet tab, a stack of mailing stubs and someone's memory.",
  },
];

const STACK = [
  ["Claude Opus", "Edge-case classification, rule research and report checks."],
  ["Claude Haiku", "Bulk classification and parsing owner replies, fast and cheap."],
  ["Stagehand", "Browser agents that fill state portals (replicas in this prototype)."],
  ["Inngest", "Durable workflows: one long-running timeline per item, surviving restarts."],
  ["MCP", "Ask Claude from your own client what you owe and where. It can only draft."],
  ["Vapi", "AI voice calls to owners, to allowlisted numbers only."],
  ["Lob", "Certified letters, in test mode."],
  ["Eval suite", "200 labeled cases: 160 generated and 40 hand-written adversarial."],
] as const;

export default function HomePage() {
  return (
    <>
      <section className="mkt-hero" aria-labelledby="hero-heading">
        <div className="mkt-wrap mkt-hero-grid">
          <div className="mkt-hero-copy">
            <h1 id="hero-heading" className="mkt-display mkt-h1 mkt-rise" style={{ "--d": 60 } as React.CSSProperties}>
              Every uncashed check is a <em className="mkt-accent">legal clock.</em>
            </h1>
            <p className="mkt-lede mkt-rise" style={{ "--d": 220 } as React.CSSProperties}>
              Escheat Agent watches every one of them. Unclaimed-property compliance still runs on spreadsheets, paper letters and state portals. The agent reads your ledger, applies each state&apos;s
              sourced rules, reaches the owner and files the report. It stops for your approval before anything that can&apos;t be undone.
            </p>
            <div className="mkt-actions mkt-rise" style={{ "--d": 360 } as React.CSSProperties}>
              <DemoButton />
              <GhostButton href="/how-it-works">See how it works</GhostButton>
            </div>
            <p className="mkt-fineprint">A hackathon prototype on synthetic data. California, Delaware and Texas.</p>
          </div>
          <HeroTrace />
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="problem-heading">
        <div className="mkt-wrap mkt-split-section">
          <div className="mkt-sticky">
            <RevealHeading id="problem-heading" className="mkt-h2">
              Your books say outstanding. The state says <em className="mkt-accent">abandoned.</em>
            </RevealHeading>
            <p className="mkt-body">
              Escheatment is the law that turns forgotten money into state property. Small and mid-size finance teams are expected to track it across every state
              where an owner lives.
            </p>
          </div>
          <ul className="mkt-facts">
            {FACTS.map((f) => (
              <li key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
            <li className="mkt-facts-note">
              Figures quoted from this project&apos;s rule files. They stay marked UNVERIFIED until a person approves them.
            </li>
          </ul>
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" id="how" aria-labelledby="how-heading">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <RevealHeading id="how-heading" className="mkt-h2">
              From a ledger export to a filed <em className="mkt-accent">report,</em> in six steps.
            </RevealHeading>
            <p className="mkt-body">
              Blue runs on its own. Pink waits for a person.{" "}
              <Link href="/how-it-works">Read the detail on each step.</Link>
            </p>
          </div>
          <ScrollSteps />
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="law-heading">
        <div className="mkt-wrap mkt-two">
          <div>
            <RevealHeading id="law-heading" className="mkt-h2">
              The model reads. The code decides the <em className="mkt-accent">law.</em>
            </RevealHeading>
            <p className="mkt-body">
              Language models are good at messy payee names and bad at being liable. So dormancy periods, due-diligence windows and report dates never come from a
              model. They come from versioned rule files, computed by deterministic code.
            </p>
            <ul className="mkt-ticks">
              <li>Every rule value carries a source link, a quote and a verified flag.</li>
              <li>Unverified values show an UNVERIFIED badge everywhere they are used.</li>
              <li>No source means UNKNOWN, never a guess.</li>
            </ul>
            <Link href="/security" className="mkt-textlink">
              Read the trust and safety model
            </Link>
          </div>
          <RuleCard />
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="approve-heading">
        <div className="mkt-wrap mkt-two mkt-two-flip">
          <ApprovalMock />
          <div>
            <RevealHeading id="approve-heading" className="mkt-h2">
              Autonomous up to the point it can&apos;t be <em className="mkt-accent">undone.</em>
            </RevealHeading>
            <p className="mkt-body">
              Mailing a letter, sending an email, placing a call, submitting a report, filing a claim, applying a rule change: each one pauses for an in-app
              approval, enforced on the server. Outreach runs in test mode only, to allowlisted recipients.
            </p>
            <ul className="mkt-ticks mkt-ticks-pink">
              <li>Approvals are bound to the payload hash and are single-use.</li>
              <li>An evidence pack for auditors: what was sent, to whom, who approved.</li>
              <li>The filing agent drives replica portals and refuses any other URL.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mkt-section" aria-labelledby="chat-heading">
        <div className="mkt-wrap mkt-two">
          <div>
            <RevealHeading id="chat-heading" className="mkt-h2">
              Run compliance from a <em className="mkt-accent">chat.</em>
            </RevealHeading>
            <p className="mkt-body">
              Ask what you owe and where, in plain English. Through an MCP server the same questions work from Claude itself: exposure, stale items, deadlines,
              why an item is flagged, interest if you file late. It can draft. It cannot approve.
            </p>
            <DemoButton>Try the demo</DemoButton>
          </div>
          <ChatMock />
        </div>
      </section>

      <section className="mkt-section mkt-section-raised" aria-labelledby="stack-heading">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <RevealHeading id="stack-heading" className="mkt-h2">
              Built on the newest agent <em className="mkt-accent">tooling.</em>
            </RevealHeading>
          </div>
          <dl className="mkt-stack">
            {STACK.map(([name, role]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{role}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mkt-final" aria-labelledby="final-heading">
        <div className="mkt-wrap">
          <RevealHeading id="final-heading" className="mkt-h2 mkt-final-h">
            See what a ledger owes the <em className="mkt-accent">states.</em>
          </RevealHeading>
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
