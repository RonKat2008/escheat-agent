/**
 * The Judge tour's stops: the canonical demo path (docs/DEMO.md) on real screens. Narration is one line of fixed copy
 * with NO figures in it. Every number a stop shows comes from `readouts`, which read the text the page itself rendered
 * at that moment (or are omitted when the element is not there). The tour only navigates and points; it never clicks
 * Approve, Send or Generate for anyone. The one action it offers is an `invite`: a button in the tour that the judge
 * presses to press the page's own reversible, read-only-on-the-world button (the recovery search), never an approval.
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
 * A page button the judge may press from the tour. The tour never presses it on its own: the judge's click on the
 * tour's button is forwarded to the page's own button, so the request is the same one the page would send.
 */
export interface TourInvite {
  /** The page's own button. */
  target: string;
  /** The tour button's text (the page button's own label). */
  label: string;
  /** Shown while the stop has no readout yet: says plainly that nothing has happened. */
  idle: string;
  /** Shown after the judge pressed it, until the result appears on the page. */
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
}

/** The demo check whose due-diligence window is open (docs/DEMO.md scene 4). */
export const TOUR_CHECK = "10087";

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "exposure",
    title: "What we owe, and where",
    path: "/dashboard",
    anchors: ['[data-tour="exposure"]', 'section[aria-label="Total exposure"]'],
    narration: "Every stale check, grouped by owner state. Stale is a business threshold we set, not the law; the law comes from the rules.",
    readouts: [
      { label: "Total", selectors: ['[data-testid="flow-exposure"]'] },
      { label: "Made of", selectors: ['[data-testid="exposure-meta"]'] },
    ],
  },
  {
    id: "money-flow",
    title: "Money flow and the Late band",
    path: "/dashboard",
    anchors: ['[data-tour="money-flow"]', '[data-testid="money-flow"]'],
    narration: "Band width is the amount. Pink is money already past a filing or due-diligence deadline, with interest computed by the rules engine.",
    readouts: [{ label: "Band", selectors: ['[data-testid="flow-late"]'] }],
  },
  {
    id: "item",
    title: "One check, every date sourced",
    path: "/items",
    resolve: { kind: "check", checkNumber: TOUR_CHECK },
    anchors: ['[data-tour="item-lifecycle"]', '[data-testid="item-lifecycle"]', '[data-testid="item-drawer"]'],
    // The drawer streams in: its skeleton has the same frame, so wait for the real header and timeline.
    loaded: ['[data-testid="item-drawer"] header h2', '[data-testid="item-lifecycle"]'],
    narration: "Each date on the lifecycle traces to a versioned rule file with an official source. Open “Why this date?” for the rule path. UNVERIFIED means no person has checked that value yet.",
    readouts: [
      { label: "Check", selectors: ['[data-testid="item-drawer"] header p .font-mono'] },
      { label: "Payee", selectors: ['[data-testid="item-drawer"] header h2'] },
    ],
  },
  {
    id: "rules",
    title: "Texas: statute vs. owner letter",
    path: "/rules",
    query: { state: "TX", field: "dueDiligence.requiredLanguage" },
    anchors: ['[data-tour="rules-adopt"]', '[data-testid="adopt-open"]', '[data-testid="field-drawer"]', "main h1"],
    narration: "Texas states a requirement, not owner wording. The review shows “Statute says”, verbatim with its source, next to an empty “Owner letter will say”.",
    human: "A person writes and approves that sentence. The model never fills a legal value.",
  },
  {
    id: "approvals",
    title: "The human gate",
    path: "/approvals",
    anchors: ['[data-tour="approval-detail"]', '[data-testid="approval-detail"]', '[data-testid="queue-count"]', "main h1"],
    narration: "You read each letter exactly as it will go out. Email and phone recipients come only from a test allowlist, shown masked.",
    readouts: [{ label: "Waiting on you", selectors: ['[data-testid="queue-count"]'] }],
    human: "You click Approve. The server requires a person; this tour never clicks it.",
  },
  {
    id: "close-out",
    title: "Close out a state",
    path: "/close-out/CA",
    // The whole progress block (count, at-stake line and rail), so the spotlight never clips the count's text.
    anchors: ['[data-tour="close-out"]', 'div:has(> div > [data-testid="runner-progress"])', '[data-testid="runner-progress"]', '[data-testid="close-out-runner"]'],
    narration: "One state's close-out, every step through the same server paths: generate and validate the report, approve it, then the browser agent files on the replica portal.",
    readouts: [{ label: "Progress", selectors: ['[data-testid="runner-progress"]'] }],
    human: "Approve submission waits for your typed name. Only your click lets the agent submit.",
  },
  {
    id: "recoveries",
    title: "Money owed to us",
    path: "/recoveries",
    anchors: ['[data-tour="recoveries"]', '[data-testid="recovery-total"]', '[data-testid="run-recovery-btn"]', "main h1"],
    narration: "The same agent in the other direction: it searches replica state databases for money owed to the company and drafts a claim for approval.",
    readouts: [{ label: "Found", selectors: ['[data-testid="recovery-total"]'], emptyWhen: /^\$?0(?:\.00)?$/ }],
    invite: {
      target: '[data-testid="run-recovery-btn"]',
      label: "Run recovery search",
      idle: "Nothing found yet: the total stays at zero until the search runs. Run it yourself: the agent searches the CA, DE and TX replica portals, and any claim still waits for your approval.",
      started: "Searching the replica portals. The total appears here when the agent finishes.",
    },
  },
  {
    id: "chat",
    title: "Ask in plain English",
    path: "/chat",
    anchors: ['[data-tour="chat"]', '[data-testid="chat-empty"]', '[data-testid="chat-input"]'],
    narration: "Each answer is a tool call rendered as a live card, not a paragraph to trust. Offline, recorded answers replay; anything unrecorded says so.",
    readouts: [{ label: "Mode", selectors: ['[data-testid="chat-model"]'] }],
  },
  {
    id: "runs",
    title: "Every agent run, logged",
    path: "/runs",
    anchors: ['[data-tour="runs"]', "main h1"],
    narration: "Filing and recovery runs are stored with the method that actually ran: live, scripted, or an offline replay, labeled as such.",
  },
  {
    id: "eval",
    title: "How well the classifier does",
    path: "/eval",
    anchors: ['[data-tour="eval"]', '[data-testid="eval-method"]', "main h1"],
    narration: "Labeled synthetic cases score the classifier. The figure is whatever the stored run recorded. The model reads, the code decides the law, and a person approves every irreversible step.",
    readouts: [{ label: "Method", selectors: ['[data-testid="eval-method-label"]'] }],
  },
];

export const TOUR_TOTAL = TOUR_STEPS.length;

export function clampIndex(i: number, total: number = TOUR_TOTAL): number {
  return Math.max(0, Math.min(total - 1, Math.trunc(i)));
}

/** The stop at `i`, clamped into range (never undefined). */
export function stepAt(i: number): TourStep {
  return TOUR_STEPS[clampIndex(i)] ?? (TOUR_STEPS[0] as TourStep);
}

export function nextIndex(i: number, total: number = TOUR_TOTAL): number | null {
  return i + 1 < total ? i + 1 : null;
}

export function prevIndex(i: number): number | null {
  return i > 0 ? i - 1 : null;
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
