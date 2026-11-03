import { DrawLine, DrawScene } from "./InViewDraw";
import { noticeWindowLabel, STATE_RULES, type Fact, type StateRuleFacts } from "./rule-facts";

export function Unverified({ verified }: { verified: boolean }) {
  if (verified) return null;
  return (
    <span className="mkt-unverified" title="This rule value has not been verified by a person. Dates that depend on it are provisional.">
      Unverified
    </span>
  );
}

function SourceRef({ fact }: { fact: Fact<unknown> }) {
  if (!fact.source) return <span className="mkt-dim">No source: UNKNOWN</span>;
  return (
    <a href={fact.source.url} target="_blank" rel="noopener noreferrer" className="lc-source">
      {fact.source.title.replace(/\s*\(.*\)$/, "")}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

interface Stop {
  key: string;
  label: string;
  value: string;
  fact: Fact<unknown>;
  human?: boolean;
}

function stops(s: StateRuleFacts): Stop[] {
  const years = s.dormancyYears.value;
  const notice = noticeWindowLabel(s.noticeWindow);
  const due = s.reportDue.value;
  return [
    { key: "dormant", label: "Presumed abandoned", value: years != null ? `${years} years after issue` : "Unknown", fact: s.dormancyYears },
    { key: "notice", label: "Owner notice", value: notice ?? "Unknown", fact: s.noticeWindow, human: true },
    { key: "report", label: due?.withRemittance ? "Report and remit" : "Report due", value: due?.label ?? "Unknown", fact: s.reportDue },
    { key: "late", label: "If late", value: s.interestPct.value != null ? `${s.interestPct.value}% a year interest` : "Unknown", fact: s.interestPct },
  ];
}

const RAIL = "M 8 12 H 992";

/**
 * Lifecycle of an uncashed vendor check, per state, quoted from the rule files (labels only, not to scale). Every
 * value carries its UNVERIFIED badge and its first source. The rail draws in when scrolled into view.
 */
export function LifecycleExplainer() {
  return (
    <div className="lc">
      {STATE_RULES.map((s, si) => (
        <DrawScene key={s.code} className="lc-row" data-testid={`lifecycle-${s.code}`}>
          <div className="lc-state">
            <span className="lc-code">{s.code}</span>
            <span className="lc-name">{s.name}</span>
            <span className="mkt-label">rules v{s.version}</span>
          </div>
          <div className="lc-track">
            <svg className="lc-rail" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
              <path d={RAIL} className="lc-rail-base" />
              <DrawLine d={RAIL} className="lc-rail-live" vectorEffect="non-scaling-stroke" delayMs={si * 120} durationMs={1100} />
            </svg>
            <ol className="lc-stops">
              <li className="lc-stop" data-kind="start">
                <span className="lc-dot" aria-hidden />
                <span className="lc-label">Check issued</span>
                <span className="lc-value">Day 0</span>
              </li>
              {stops(s).map((st, i) => (
                <li key={st.key} className="lc-stop" data-human={st.human ? "true" : undefined} style={{ "--i": i + 1 } as React.CSSProperties}>
                  <span className="lc-dot" aria-hidden />
                  <span className="lc-label">{st.label}</span>
                  <span className="lc-value">{st.value}</span>
                  <span className="lc-meta">
                    <Unverified verified={st.fact.verified} />
                    <SourceRef fact={st.fact} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </DrawScene>
      ))}
    </div>
  );
}
