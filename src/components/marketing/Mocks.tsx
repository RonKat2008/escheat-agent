import { Bolt } from "./Bolt";

/** Static product mocks. Synthetic demo figures only (see README "Running the demo"). */

export function RuleCard() {
  return (
    <figure className="mkt-rule" aria-label="Excerpt of a rule file entry">
      <div className="mkt-rule-head">
        <span className="mkt-mono">rules/CA.json</span>
        <span className="mkt-mono mkt-dim">interest</span>
        <span className="mkt-badge mkt-badge-warn">UNVERIFIED</span>
      </div>
      <dl className="mkt-rule-body">
        <div>
          <dt>value</dt>
          <dd>12% per annum, simple</dd>
        </div>
        <div>
          <dt>source</dt>
          <dd>
            <a href="https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=1577" target="_blank" rel="noopener noreferrer">
              Cal. Code Civ. Proc. section 1577
            </a>
          </dd>
        </div>
        <div>
          <dt>quote</dt>
          <dd className="mkt-quote">
            &ldquo;shall pay to the Controller interest at the rate of 12 percent per annum on that property or value thereof from the date the property
            should have been reported, paid, or delivered.&rdquo;
          </dd>
        </div>
        <div>
          <dt>retrieved</dt>
          <dd className="mkt-mono">2026-10-29</dd>
        </div>
      </dl>
      <figcaption className="mkt-rule-foot">
        <span className="mkt-mono">engine</span> If a value is missing the engine returns <strong>UNKNOWN</strong>. It never guesses.
      </figcaption>
    </figure>
  );
}

export function ApprovalMock() {
  return (
    <figure className="mkt-approval" aria-label="Illustration of an approval request">
      <div className="mkt-approval-head">
        <span className="mkt-chip mkt-chip-human">Needs your approval</span>
        <span className="mkt-trace-synth">Illustration</span>
      </div>
      <h3>Mail a due-diligence letter</h3>
      <dl className="mkt-approval-grid">
        <div>
          <dt>To</dt>
          <dd>Bayline Electric (synthetic)</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>Certified letter, Lob TEST mode</dd>
        </div>
        <div>
          <dt>Payload hash</dt>
          <dd className="mkt-mono">9c1e&hellip;a47b</dd>
        </div>
      </dl>
      <p className="mkt-approval-note">
        The approval is tied to the hash of exactly what you reviewed. Change a word and it no longer matches, so nothing goes out.
      </p>
      <div className="mkt-approval-actions" aria-hidden>
        <span className="mkt-fake-btn mkt-fake-btn-yes">Approve</span>
        <span className="mkt-fake-btn">Reject</span>
      </div>
    </figure>
  );
}

export function ChatMock() {
  return (
    <figure className="mkt-chat" aria-label="Illustration of a chat with Escheat Agent">
      <div className="mkt-chat-bar">
        <span className="mkt-trace-title">
          <Bolt /> Ask Escheat Agent
        </span>
        <span className="mkt-trace-synth">Synthetic demo company</span>
      </div>
      <div className="mkt-chat-body">
        <p className="mkt-msg mkt-msg-user">What do we owe in unclaimed property, and where?</p>
        <div className="mkt-msg mkt-msg-agent">
          <p>
            <strong>$61,915.00</strong> across <strong>47</strong> stale items.
          </p>
          <ul className="mkt-split">
            <li>
              <span>California</span>
              <span>21 items</span>
              <span>$28,410</span>
            </li>
            <li>
              <span>Texas</span>
              <span>15 items</span>
              <span>$19,862</span>
            </li>
            <li>
              <span>Delaware</span>
              <span>11 items</span>
              <span>$13,643</span>
            </li>
          </ul>
          <p>
            Largest: check #10482, Bayline Electric, $2,340.00. Every date is computed from the rule files and still shows UNVERIFIED until a person
            approves the rule.
          </p>
        </div>
        <p className="mkt-msg mkt-msg-user">Draft the letter for that one.</p>
        <div className="mkt-msg mkt-msg-agent mkt-msg-human">
          <p>Draft ready. It is waiting in Approvals. Nothing is sent from chat.</p>
        </div>
      </div>
    </figure>
  );
}
