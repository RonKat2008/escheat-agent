export type Actor = "agent" | "you";

export interface Step {
  id: string;
  title: string;
  /** One sentence for the home page. */
  short: string;
  actor: Actor;
  actorNote: string;
  /** Longer copy for /how-it-works. */
  agent: string;
  stays: string;
  leaves: string;
}

export const STEPS: readonly Step[] = [
  {
    id: "connect",
    title: "Connect the ledger",
    short: "Drop in a CSV or link QuickBooks, plus the bank clears. Bad rows are reported, never silently dropped.",
    actor: "agent",
    actorNote: "Agent reads",
    agent:
      "Ingests your check register and credits from CSV (with column mapping and schema validation) or QuickBooks Online, and pulls bank clears from Plaid sandbox. Rows that fail validation are listed with the reason.",
    stays: "You choose what to connect. Credentials stay in environment variables, never in the repo.",
    leaves: "An import record per file, with the rejected rows and why they were rejected.",
  },
  {
    id: "detect",
    title: "Detect what went stale",
    short: "Checks are matched to bank clears. Voids, late clears and ambiguous ties are flagged for a person.",
    actor: "agent",
    actorNote: "Agent flags",
    agent:
      "Matches each check to a clear by number, then by amount and date. Name variants of the same payee are resolved, and the owner's state is re-derived in code (last known address first, state of incorporation second) so a model can never override it.",
    stays: "Anything ambiguous goes to a review queue. Stale is your business threshold (180 days by default), not law.",
    leaves: "A reconciliation trail for every item, including the ones the agent was not sure about.",
  },
  {
    id: "law",
    title: "Apply the law, deterministically",
    short: "A rules engine over versioned, sourced state files computes every date. The model never decides the law.",
    actor: "agent",
    actorNote: "Code computes",
    agent:
      "Dormancy, due-diligence windows, report and remit dates come from rule files for California, Delaware and Texas. Each value carries a source link, a quote and a verified flag. A missing value yields UNKNOWN, and an unverified one carries an UNVERIFIED badge everywhere it is used.",
    stays: "Applying a rule change is an approval step. You can read the source behind every date.",
    leaves: "For each date: the rule path, the rule version and the source links it came from.",
  },
  {
    id: "owner",
    title: "Reach the owner",
    short: "A due-diligence letter, an email and a voice call, each drafted by the agent and sent only after you approve it.",
    actor: "you",
    actorNote: "You approve",
    agent:
      "Drafts the statutory letter from the rule file's own text, then the email and the call script. Letters go through Lob in test mode, email only to an allowlist, calls only to allowlisted numbers. Owners get a signed, single-use link to answer.",
    stays: "Nothing is mailed, emailed or dialed until you approve the exact payload.",
    leaves: "The sent payload, its hash, who approved it and when, and the owner's response.",
  },
  {
    id: "file",
    title: "File and remit",
    short: "A browser agent walks the state portal, checks the totals, and stops at Approve submission.",
    actor: "you",
    actorNote: "You approve",
    agent:
      "Generates a validated NAUPA II file and an evidence pack, then a Stagehand browser agent logs in, uploads, and checks the portal's totals against yours. In this prototype it drives replica portals only; code refuses any other URL.",
    stays: "The agent pauses before submitting. You approve in the app, then it submits and records the confirmation.",
    leaves: "The filed report, the evidence pack for auditors and the confirmation number.",
  },
  {
    id: "recover",
    title: "Recover money owed to you",
    short: "The agent searches state databases for your company's name variants and drafts a claim for approval.",
    actor: "you",
    actorNote: "You approve",
    agent:
      "Searches replica state unclaimed-property databases for your company name and its variants, then drafts a claim with the supporting detail.",
    stays: "Filing the claim is an approval step, like every other irreversible action.",
    leaves: "The search results, the drafted claim and the approval record.",
  },
];
