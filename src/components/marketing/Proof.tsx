import Link from "next/link";
import { GATED_ACTIONS } from "./GateExplainer";
import { Unverified } from "./LifecycleExplainer";
import { STATE_RULES, type StateRuleFacts } from "./rule-facts";

/** value -> rule path -> source, rendered from a real rule-file entry (illustrative mode: rule content only). */
export function RuleProvenance({ state = "CA" }: { state?: StateRuleFacts["code"] }) {
  const s = STATE_RULES.find((r) => r.code === state)!;
  const f = s.dormancyYears;
  return (
    <figure className="prov" aria-label={`Where the ${s.name} dormancy period comes from`}>
      <div className="prov-head">
        <span className="mkt-label">rules/{s.code}.json</span>
        <span className="mkt-label">v{s.version}</span>
        <Unverified verified={f.verified} />
      </div>
      <ol className="prov-chain">
        <li>
          <span className="mkt-label">Value</span>
          <strong className="prov-value">{f.value != null ? `${f.value} years` : "Unknown"}</strong>
          <span className="prov-note">Vendor check dormancy</span>
        </li>
        <li>
          <span className="mkt-label">Rule path</span>
          <code>{f.path}</code>
        </li>
        <li>
          <span className="mkt-label">Source</span>
          {f.source ? (
            <>
              <a href={f.source.url} target="_blank" rel="noopener noreferrer">
                {f.source.title.replace(/\s*\(.*\)$/, "")}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {f.source.quote ? <blockquote>&ldquo;{f.source.quote}&rdquo;</blockquote> : null}
            </>
          ) : (
            <span>No source, so the engine answers UNKNOWN.</span>
          )}
        </li>
      </ol>
      <figcaption>A missing value is never guessed: the engine returns UNKNOWN, and every date that depends on it says so.</figcaption>
    </figure>
  );
}

/** The four receipts. Every figure here is true of this prototype (README, fixtures/eval). */
export function ProofGrid() {
  return (
    <div className="proof">
      <article className="proof-card proof-rules">
        <header>
          <span className="mkt-label">01 · Rules with sources</span>
          <h3>The law is a file you can read.</h3>
        </header>
        <p>Dormancy, notice windows, report dates and interest for California, Delaware and Texas, each with a source link, a quote and a verified flag.</p>
        <RuleProvenance />
      </article>
      <article className="proof-card proof-gate">
        <header>
          <span className="mkt-label mkt-label-human">02 · The approval gate</span>
          <h3>{GATED_ACTIONS.length} kinds of action stop for a person.</h3>
        </header>
        <p>Enforced on the server, bound to the payload hash, single-use. The MCP server can draft; it cannot approve.</p>
      </article>
      <article className="proof-card proof-eval">
        <header>
          <span className="mkt-label">03 · Measured, not claimed</span>
          <h3>
            <span className="proof-num">200</span> labeled eval cases
          </h3>
        </header>
        <p>160 generated and 40 hand-written adversarial. Each run is stored with the method that actually ran; this page quotes no accuracy figure.</p>
        <Link href="/eval" prefetch={false} className="mkt-textlink">
          See the stored run in the demo
        </Link>
      </article>
      <article className="proof-card proof-replica">
        <header>
          <span className="mkt-label">04 · Replica-only</span>
          <h3>It has never touched a real state.</h3>
        </header>
        <p>
          Filing and recovery agents run against <code>/replica/*</code> portals in this repo, fenced at the URL, network and DNS level. Letters go out in
          Lob test mode; email and calls reach allowlisted recipients only.
        </p>
      </article>
    </div>
  );
}

const LIMITS = [
  ["Synthetic data", "Northwind Fixtures, Inc. and every payee, address and amount are generated. The holder TIN is 000000000."],
  ["Three states", "California, Delaware and Texas. Anything else is out of scope and shown as UNKNOWN."],
  ["Unverified rules", "Rule values were researched from official sources but stay UNVERIFIED until a person approves them."],
  ["Replica portals", "No real state is filed with or searched. The portals imitate a holder-filing site and a search site."],
  ["Test-mode outreach", "Lob test mode only; email and calls to allowlisted test recipients only."],
] as const;

export function HonestLimits() {
  return (
    <dl className="limits">
      {LIMITS.map(([t, d]) => (
        <div key={t}>
          <dt>{t}</dt>
          <dd>{d}</dd>
        </div>
      ))}
    </dl>
  );
}
