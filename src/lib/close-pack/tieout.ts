/**
 * Close-pack tie-out: reconciles the pack's own numbers to each other, deterministically, in integer cents. Pure.
 * A line either ties, "does not tie: <difference>", or is "not available" with the reason. Nothing is forced to tie.
 */
import type { Journal } from "@/lib/ledger/journal";
import type { RollForward } from "@/lib/ledger/rollforward";
import { formatUSD } from "@/lib/money";
import type { AuditChain } from "./chain";

export type TieStatus = "tie" | "no_tie" | "n/a";

export interface TieLine {
  id: string;
  section: "Journal" | "Roll-forward" | "Activity" | "Audit chain" | "Files";
  label: string;
  status: TieStatus;
  /** Tie: what was compared. No tie: "<difference>". N/A: why. */
  detail: string;
}

export interface PackFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface TieOutInput {
  journal: Journal;
  roll: RollForward;
  /** Open liability at the period end per state, computed from item-level outstanding amounts (independent of the flows). null = could not be computed. */
  payableByState: ReadonlyMap<string, number> | null;
  payableNote?: string;
  activity: { csvRows: number; loadedRows: number; truncated: boolean };
  /** null when the chain could not be built. */
  chain: (AuditChain & { verified: boolean }) | null;
  files: readonly PackFile[];
}

/** Account code of a state's payable sub-account (see ledger/accounts.ts upPayable). */
const payableCode = (state: string) => `2400-${state}`;

const usd = formatUSD;
const diff = (a: number, b: number) => usd(a - b);

function ties(id: string, section: TieLine["section"], label: string, left: number, right: number, what: string): TieLine {
  return left === right
    ? { id, section, label, status: "tie", detail: `${what}: ${usd(left)}` }
    : { id, section, label, status: "no_tie", detail: `${what}: ${usd(left)} vs ${usd(right)}, difference ${diff(left, right)}` };
}

export function computeTieOut(input: TieOutInput): TieLine[] {
  const out: TieLine[] = [];
  const { journal, roll } = input;

  // 1. Journal: debits = credits per state, and in total.
  const jStates = new Map(journal.byState.map((s) => [s.state, s]));
  for (const r of [...roll.states, roll.total]) {
    if (r.state === "Total") {
      out.push(ties("journal-total", "Journal", "All states: debits = credits", journal.debitCents, journal.creditCents, "debits vs credits"));
      continue;
    }
    const j = jStates.get(r.state);
    out.push(ties(`journal-${r.state}`, "Journal", `${r.state}: debits = credits`, j?.debitCents ?? 0, j?.creditCents ?? 0, "debits vs credits"));
  }

  // 2. Roll-forward identity, journal movement of the payable, and closing = ledger payable, per state.
  for (const r of [...roll.states, roll.total]) {
    const isTotal = r.state === "Total";
    const tag = isTotal ? "total" : r.state;
    const name = isTotal ? "All states" : r.state;
    const closing = r.opening + r.identified - r.resolved - r.clearedLate - r.remitted;
    out.push(
      ties(`roll-${tag}`, "Roll-forward", `${name}: opening + additions - remittances = closing`, closing, r.closing, `${usd(r.opening)} + ${usd(r.identified)} - ${usd(r.resolved + r.clearedLate + r.remitted)} (resolved, cleared late, remitted)`),
    );
    const net = journal.entries
      .filter((e) => isTotal || e.state === r.state)
      .flatMap((e) => e.lines)
      .filter((l) => l.account.code.startsWith("2400-") && (isTotal || l.account.code === payableCode(r.state)))
      .reduce((a, l) => a + l.creditCents - l.debitCents, 0);
    out.push(ties(`je-payable-${tag}`, "Roll-forward", `${name}: journal change in payable = closing - opening`, net, r.closing - r.opening, "journal payable credits - debits"));
    if (input.payableByState === null) {
      out.push({ id: `payable-${tag}`, section: "Roll-forward", label: `${name}: closing = ledger payable`, status: "n/a", detail: `not available: ${input.payableNote ?? "the item-level payable could not be computed"}` });
    } else {
      const payable = isTotal ? [...input.payableByState.values()].reduce((a, b) => a + b, 0) : (input.payableByState.get(r.state) ?? 0);
      out.push(ties(`payable-${tag}`, "Roll-forward", `${name}: closing = ledger payable`, r.closing, payable, "roll-forward closing vs open items at period end"));
    }
  }

  // 3. Activity rows.
  const a = input.activity;
  if (a.truncated) {
    out.push({ id: "activity-count", section: "Activity", label: "Activity rows in the period", status: "no_tie", detail: `the export hit its row cap: ${a.loadedRows} rows loaded, more exist` });
  } else {
    out.push({
      id: "activity-count",
      section: "Activity",
      label: `Activity rows in the period: ${a.csvRows}`,
      status: a.csvRows === a.loadedRows ? "tie" : "no_tie",
      detail: a.csvRows === a.loadedRows ? `${a.csvRows} CSV rows = ${a.loadedRows} rows loaded` : `${a.csvRows} CSV rows vs ${a.loadedRows} loaded, difference ${a.csvRows - a.loadedRows}`,
    });
  }

  // 4. Audit chain.
  if (!input.chain) {
    out.push({ id: "chain", section: "Audit chain", label: "Audit chain verified", status: "n/a", detail: "not available: the chain could not be built" });
  } else {
    const c = input.chain;
    out.push({
      id: "chain",
      section: "Audit chain",
      label: `Audit chain verified: ${c.length} links`,
      status: c.verified ? "tie" : "no_tie",
      detail: c.verified ? `head ${c.head}` : `recomputing from activity CSV does not reproduce head ${c.head}`,
    });
  }

  // 5. Files.
  for (const f of input.files) {
    out.push({ id: `file-${f.name}`, section: "Files", label: f.name, status: /^[0-9a-f]{64}$/.test(f.sha256) ? "tie" : "no_tie", detail: `sha256 ${f.sha256} (${f.bytes} bytes)` });
  }
  return out;
}

export const allTie = (lines: readonly TieLine[]): boolean => lines.every((l) => l.status === "tie");
