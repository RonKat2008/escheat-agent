import { DrawLine, DrawScene } from "./InViewDraw";

/** The six action types that pause for an in-app approval (src/lib/approvals; README "Guardrails"). */
export const GATED_ACTIONS = ["Mail a letter", "Send an email", "Place a call", "Submit a report", "File a claim", "Apply a rule change"] as const;

function Connector({ delayMs, human }: { delayMs: number; human?: boolean }) {
  const cls = human ? "gx-wire gx-wire-human" : "gx-wire";
  return (
    <li className="gx-connector" aria-hidden="true">
      <svg className="gx-h" viewBox="0 0 100 12" preserveAspectRatio="none">
        <path d="M 0 6 H 100" className="gx-wire-base" vectorEffect="non-scaling-stroke" />
        <DrawLine d="M 0 6 H 100" className={cls} vectorEffect="non-scaling-stroke" delayMs={delayMs} durationMs={700} />
      </svg>
      <svg className="gx-v" viewBox="0 0 12 100" preserveAspectRatio="none">
        <path d="M 6 0 V 100" className="gx-wire-base" vectorEffect="non-scaling-stroke" />
        <DrawLine d="M 6 0 V 100" className={cls} vectorEffect="non-scaling-stroke" delayMs={delayMs} durationMs={700} />
      </svg>
    </li>
  );
}

/**
 * "Nothing leaves without you": structure only, no company data. Cause, path, effect: the draft appears, the wire
 * draws to the gate, the gate holds in pink, and only then does the second wire draw to the outcome.
 */
export function GateExplainer() {
  return (
    <DrawScene className="gx" data-testid="gate-explainer">
      <ol className="gx-flow" aria-label="Approval flow">
        <li className="gx-node" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="mkt-label">Agent</span>
          <strong>Drafts the action</strong>
          <span>Letter, email, call script, report or claim, with the evidence behind it.</span>
        </li>
        <Connector delayMs={150} />
        <li className="gx-node" style={{ "--i": 1 } as React.CSSProperties}>
          <span className="mkt-label">Server</span>
          <strong>Hashes the exact payload</strong>
          <code className="gx-hash">sha256(payload)</code>
        </li>
        <Connector delayMs={700} human />
        <li className="gx-node gx-gate" style={{ "--i": 2 } as React.CSSProperties}>
          <span className="gx-ring" aria-hidden />
          <span className="mkt-label mkt-label-human">You</span>
          <strong>Approve or reject</strong>
          <span>Bound to that hash, single-use, time-limited, checked on the server.</span>
        </li>
        <Connector delayMs={1500} />
        <li className="gx-node gx-out" style={{ "--i": 3 } as React.CSSProperties}>
          <span className="mkt-label">Then, and only then</span>
          <strong>It leaves</strong>
          <span>Test-mode letter, allowlisted email or call, replica portal filing.</span>
        </li>
      </ol>
      <ul className="gx-actions" aria-label="Actions that need your approval">
        {GATED_ACTIONS.map((a) => (
          <li key={a}>
            <span aria-hidden className="gx-actions-shape" />
            {a}
          </li>
        ))}
      </ul>
    </DrawScene>
  );
}
