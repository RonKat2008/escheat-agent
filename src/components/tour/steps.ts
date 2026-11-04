/**
 * The first-run tour's stops: the product story on real screens, in order. Narration is at most two plain sentences
 * with NO figures in it: what the part does and why a finance team cares. Every number a stop shows comes from
 * `readouts`, which read the text the page itself rendered at that moment (or are omitted when the element is not
 * there). The tour only navigates and points; it never clicks Approve, Send or File for anyone. The one action it
 * offers is an `invite`: a button in the tour that the person presses to press the page's own reversible,
 * read-only-on-the-world button (the recovery search), never an approval.
 */
import { TOUR_PARAM } from "./tour-url";

/** A runtime value the stop reads off the real page: the first matching element's visible text. */
export interface TourReadout {
  label: string;
  selectors: readonly string[];
  /** Page text that means "nothing to show yet" (a zero total before anything ran): the readout is left out. */
  emptyWhen?: RegExp;
}

/**
 * A page button the person may press from the tour. The tour never presses it on its own: the click on the tour's
 * button is forwarded to the page's own button, so the request is the same one the page would send.
 */
export interface TourInvite {
  /** The page's own button. */
  target: string;
  /** The tour button's text (the page button's own label). */
  label: string;
  /** Shown while the stop has no readout yet: says plainly that nothing has happened. */
  idle: string;
  /** Shown after the person pressed it, until the result appears on the page. */
  started: string;
}

export interface TourStep {
  id: string;
  title: string;
  /** Pathname the stop lives on. */
  path: string;
  /** Query the stop needs (besides `tour`). */
  query?: Readonly<Record<string, string>>;
  /** Resolved at runtime from real data before navigating (the item id for a check number). */
  resolve?: { kind: "check"; checkNumber: string };
  /** Where to point, most specific first; the first visible match wins. */
  anchors: readonly string[];
  /**
   * Selectors that must all be visible before the stop counts as on screen (content, not its skeleton). Anchors inside
   * an `aria-busy="true"` region never count either.
   */
  loaded?: readonly string[];
  narration: string;
  readouts?: readonly TourReadout[];
  invite?: TourInvite;
  /** A person must act here (pink). The note says what they do; the tour never does it. */
  human?: string;
  /** The route may not exist in this build: probed before the tour starts and left out when it 404s. */
  optional?: boolean;
}

/** The demo check whose due-diligence window is open (docs/DEMO.md scene 4). */
export const TOUR_CHECK = "10087";

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "exposure",
    title: "What you owe, and where",
    path: "/dashboard",
    anchors: ['[data-tour="exposure-total"]', '[data-tour="exposure"]', 'section[aria-label="Total exposure"]'],
    narration: "This is every stale check you still owe to a state and have not reported yet. Stale is a business threshold you set; the deadlines come from the rules.",
    readouts: [
      { label: "Total", selectors: ['[data-testid="flow-exposure"]'] },
      { label: "Made of", selectors: ['[data-testid="exposure-meta"]'] },
    ],
  },
  {
    id: "states",
    title: "Which states hold the risk",
    path: "/dashboard",
    anchors: ['[data-tour="states"]', '[data-testid="money-flow"]'],
    narration: "Each column is the money owed to one owner state, and a pink ring means a deadline there is close or past. It tells you which state to close out first.",
  },
  {
    id: "item",
    title: "One check, every date sourced",
    path: "/items",
    resolve: { kind: "check", checkNumber: TOUR_CHECK },
    anchors: ['[data-tour="item-lifecycle"]', '[data-testid="item-lifecycle"]', '[data-testid="item-drawer"]'],
    // The drawer streams in: its skeleton has the same frame, so wait for the real header and timeline.
    loaded: ['[data-testid="item-drawer"] header h2', '[data-testid="item-lifecycle"]'],
    narration: "Every date on this timeline comes from a versioned rule file, with its official source listed below. The LLM never decides the law, and UNVERIFIED means no person has checked that value yet.",
    readouts: [
      { label: "Check", selectors: ['[data-testid="item-drawer"] header p .font-mono'] },
      { label: "Payee", selectors: ['[data-testid="item-drawer"] header h2'] },
    ],
  },
  {
    id: "rules",
    title: "Rules next to the statute",
    path: "/rules",
    query: { state: "TX", field: "dueDiligence.requiredLanguage" },
    anchors: ['[data-tour="rules-adopt"]', '[data-testid="adopt-open"]', '[data-testid="field-drawer"]', "main h1"],
    narration: "Each state's rules are plain data, shown with the statute quoted beside them. When the statute gives no wording, the field stays empty until a person writes it.",
    human: "A person writes and approves that sentence. The model never fills a legal value.",
  },
  {
    id: "approvals",
    title: "The human gate",
    path: "/approvals",
    anchors: ['[data-tour="approval-detail"]', '[data-testid="approval-detail"]', '[data-testid="queue-count"]', "main h1"],
    narration: "You read each owner letter exactly as it will go out, and the server refuses to send anything a person has not approved. Pink always means a human must act.",
    readouts: [{ label: "Waiting on you", selectors: ['[data-testid="queue-count"]'] }],
    human: "You click Approve. The server requires a person; this tour never clicks it.",
  },
  {
    id: "close-out",
    title: "Close out a state",
    path: "/close-out/CA",
    // The whole progress block (count, at-stake line and rail), so the spotlight never clips the count's text.
    anchors: ['[data-tour="close-out"]', 'div:has(> div > [data-testid="runner-progress"])', '[data-testid="runner-progress"]', '[data-testid="close-out-runner"]'],
    narration: "One runner takes a state from open items to a filed report, one step at a time. You see what is done, what is next, and what waits on you.",
    readouts: [{ label: "Progress", selectors: ['[data-testid="runner-progress"]'] }],
    human: "Approve submission waits for your typed name. Only your click lets the agent submit.",
  },
  {
    id: "reports",
    title: "Reports and the replica filing",
    path: "/reports",
    query: { state: "CA" },
    anchors: ['[data-tour="filing"]', '[data-testid="filing-panel"]', '[data-testid="report-detail"]', "main h1"],
    narration: "The state report file is generated and validated here, then a browser agent files it on a replica state portal. Nothing is ever filed with a real state.",
  },
  {
    id: "audit",
    title: "Audit drill",
    path: "/audit",
    query: { state: "DE" },
    anchors: ['[data-tour="audit"]', '[data-testid="readiness-gauge"]', '[data-testid="audit-results"]', "main h1"],
    narration: "Simulate a state's audit request and see each sampled item traced from the ledger row to the remittance. Gaps show up here before an auditor finds them.",
    readouts: [{ label: "Ready", selectors: ['[data-testid="readiness-pct"]'] }],
  },
  {
    id: "forecast",
    title: "What comes due next",
    path: "/forecast",
    anchors: ['[data-tour="forecast"]', '[data-testid="forecast-chart"]', "main h1"],
    narration: "Upcoming filings and due-diligence windows, month by month. Plan cash and staff time before the deadline, not after it.",
  },
  {
    id: "horizon",
    title: "The horizon",
    path: "/horizon",
    optional: true,
    anchors: ['[data-tour="horizon"]', '[data-testid="horizon-scrubber"]', '[data-testid="horizon"]', "main h1"],
    narration: "Slide forward in time to see which checks go stale and what each one costs to resolve. Next quarter's surprises become this week's worklist.",
  },
  {
    id: "ledger",
    title: "The ledger",
    path: "/ledger",
    optional: true,
    anchors: ['[data-tour="ledger"]', '[data-testid="ledger-waterfall"]', '[data-testid="ledger"]', "main h1"],
    narration: "The unclaimed property liability, rolled forward like any balance sheet account with the journal entries behind it. Your controller can tie it out to the general ledger.",
  },
  {
    id: "recoveries",
    title: "Money owed to you",
    path: "/recoveries",
    anchors: ['[data-tour="recoveries"]', '[data-testid="recovery-total"]', '[data-testid="run-recovery-btn"]', "main h1"],
    narration: "The same agent works in reverse: it searches replica state databases for money owed to the company. Any claim it drafts still waits for your approval.",
    readouts: [{ label: "Found", selectors: ['[data-testid="recovery-total"]'], emptyWhen: /^\$?0(?:\.00)?$/ }],
    invite: {
      target: '[data-testid="run-recovery-btn"]',
      label: "Run recovery search",
      idle: "Nothing found yet: the total stays at zero until the search runs. Run it yourself: the agent searches the CA, DE and TX replica portals, and any claim still waits for your approval.",
      started: "Searching the replica portals. The total appears here when the agent finishes.",
    },
  },
  {
    id: "runs",
    title: "Every agent run, traced",
    path: "/runs",
    anchors: ['[data-tour="runs"]', "main h1"],
    narration: "Every filing and recovery run is logged with how it actually ran: live, scripted or replayed. Open one for its step-by-step trace with screenshots.",
  },
  {
    id: "chat",
    title: "Ask in plain English",
    path: "/chat",
    anchors: ['[data-tour="chat"]', '[data-testid="chat-empty"]', '[data-testid="chat-input"]'],
    narration: "Each answer comes back as a live card built from the same data, not a paragraph to trust. Offline, recorded answers replay and anything unrecorded says so.",
    readouts: [{ label: "Mode", selectors: ['[data-testid="chat-model"]'] }],
  },
];

/** Every stop, before route probing. The running tour uses `availableSteps` instead. */
export const TOUR_TOTAL = TOUR_STEPS.length;

/** The stops whose route exists: an optional stop on a path known to be missing is left out. Order is kept. */
export function availableSteps(steps: readonly TourStep[], missingPaths: ReadonlySet<string>): readonly TourStep[] {
  return steps.filter((s) => !(s.optional && missingPaths.has(s.path)));
}

/** The distinct paths that need a probe before the tour starts (optional stops only). */
export function optionalPaths(steps: readonly TourStep[]): string[] {
  return [...new Set(steps.filter((s) => s.optional).map((s) => s.path))];
}

export function clampIndex(i: number, total: number = TOUR_TOTAL): number {
  return Math.max(0, Math.min(total - 1, Math.trunc(i)));
}

/** The stop at `i`, clamped into range (never undefined). */
export function stepAt(i: number, steps: readonly TourStep[] = TOUR_STEPS): TourStep {
  return steps[clampIndex(i, steps.length)] ?? (steps[0] as TourStep);
}

export function nextIndex(i: number, total: number = TOUR_TOTAL): number | null {
  return i + 1 < total ? i + 1 : null;
}

export function prevIndex(i: number): number | null {
  return i > 0 ? i - 1 : null;
}

/**
 * Where to go when stop `i` turns out to have nothing to point at: one more stop in the direction the person was
 * moving. Null at either end (the stop then stays and says so instead of bouncing).
 */
export function skipTarget(i: number, dir: 1 | -1, total: number): number | null {
  const t = i + dir;
  return t >= 0 && t < total ? t : null;
}

/** "4 of 12": the progress label (1-based). */
export function progressLabel(i: number, total: number): string {
  return `${i + 1} of ${total}`;
}

/** The stop's URL: its path, its query, any runtime-resolved query, and `tour=N` (1-based). */
export function stepHref(step: TourStep, index: number, resolved: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams({ ...step.query, ...resolved });
  params.set(TOUR_PARAM, String(index + 1));
  return `${step.path}?${params.toString()}`;
}

/**
 * Is the browser already where this stop lives? Same path, and every query value the stop needs is present. A stop
 * resolved at runtime (the check) only needs its `item` param, whatever id it holds.
 */
export function atStep(step: TourStep, pathname: string, search: string): boolean {
  if (pathname.replace(/\/$/, "") !== step.path) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [k, v] of Object.entries(step.query ?? {})) if (params.get(k) !== v) return false;
  // A resolved check opens its drawer (`item`); if the lookup failed, the fallback is the search for that check (`q`).
  if (step.resolve && !params.get("item") && params.get("q") !== step.resolve.checkNumber) return false;
  return true;
}

/** A readout value, or null when there is nothing to show (empty, or text that means "nothing yet"). */
export function readoutValue(text: string | null | undefined, emptyWhen?: RegExp, max = 140): string | null {
  const v = cleanReadout(text, max);
  if (v === null) return null;
  return emptyWhen?.test(v) ? null : v;
}

/** Collapse a page's text into one short line for the readout; null when there is nothing to show. */
export function cleanReadout(text: string | null | undefined, max = 140): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
