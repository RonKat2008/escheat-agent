/**
 * The chat prompts that have recorded cassettes (fixtures/cassettes/chat). `scripts/record-chat-cassettes.ts` records
 * exactly these groups, and the offline chat UI uses the same list so it never suggests a prompt with no recording.
 *
 * A cassette's key is the WHOLE conversation (src/lib/chat/replay-key.ts), so a prompt only replays at the position it
 * was recorded at: a `single` replays as the first turn of a new chat, and a `conversation` replays turn by turn only
 * when the earlier turns were exactly the recorded ones.
 */
export interface RecordedGroup {
  singles?: readonly string[];
  conversation?: readonly string[];
}

/**
 * Prompt groups. Each group is recorded (and verified) against its OWN freshly seeded database, because some prompts
 * change data (a draft, a report) and the replay key includes tool results: a group recorded after another group's
 * writes would only replay in that exact order, and the demo always starts from a fresh seed (dogfood R3-01).
 * Read-only prompts share one group; each multi-turn conversation sends the real prior reply back.
 */
export const RECORDED_CHAT_GROUPS: Readonly<Record<string, RecordedGroup>> = {
  reads: {
    singles: [
      "What do we owe in unclaimed property, and where?",
      "What's due in the next 90 days?",
      "Explain check #10482",
      "Which rules are unverified?",
    ],
  },
  // #10087 (Ravenhill Cabinetry, CA) has an open due-diligence window on the demo date; #10482's opens Oct 31, 2028 (R4-03).
  demo: { conversation: ["What do we owe and where?", "Explain check #10087", "Draft the due-diligence letter for #10087"] },
  draft: { singles: ["Draft the due-diligence letter for #10087"] },
  // The same request for an item whose window is not open: chat refuses with the reason and the date (R4-03). Writes nothing.
  early: { singles: ["Draft the due-diligence letter for #10482"] },
  report: { singles: ["Generate the CA report"] },
  // The empty state's guided close-out chips (plan_close_out).
  closeout: { singles: ["Close out California for this cycle", "Close out Delaware for this cycle", "Close out Texas for this cycle"] },
};

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Prompts that have a recording as the NEXT user turn after `asked` (the user prompts already sent, in order).
 * Empty history: every single plus the first turn of every conversation. Otherwise: the next turn of each recorded
 * conversation whose opening turns match `asked` exactly.
 */
export function recordedNextPrompts(asked: readonly string[], groups: Readonly<Record<string, RecordedGroup>> = RECORDED_CHAT_GROUPS): string[] {
  const out: string[] = [];
  const add = (p: string | undefined) => {
    if (p && !out.some((o) => norm(o) === norm(p))) out.push(p);
  };
  for (const g of Object.values(groups)) {
    if (asked.length === 0) g.singles?.forEach(add);
    const conv = g.conversation ?? [];
    if (asked.length < conv.length && asked.every((a, i) => norm(a) === norm(conv[i]!))) add(conv[asked.length]);
  }
  return out;
}

/** True when `prompt`, sent after `asked`, has a recorded answer. */
export function hasRecordedAnswer(asked: readonly string[], prompt: string, groups?: Readonly<Record<string, RecordedGroup>>): boolean {
  return recordedNextPrompts(asked, groups).some((p) => norm(p) === norm(prompt));
}

/**
 * Offline chips: keep only suggestions that would replay (or that `alsoOk` says can be answered another way, such as
 * directly from the data), then top up with the recorded next turns (in recorded order) so a recorded conversation can
 * still be continued by tapping. Never returns a prompt that offline chat cannot answer.
 */
export function recordedOnly(
  suggestions: readonly string[],
  asked: readonly string[],
  max: number,
  groups?: Readonly<Record<string, RecordedGroup>>,
  alsoOk: (prompt: string) => boolean = () => false,
): string[] {
  const next = recordedNextPrompts(asked, groups);
  const ok = (p: string) => next.some((n) => norm(n) === norm(p)) || alsoOk(p);
  const out: string[] = [];
  for (const p of [...suggestions.filter(ok), ...next]) {
    if (out.length >= max) break;
    if (!out.some((o) => norm(o) === norm(p)) && !asked.some((a) => norm(a) === norm(p))) out.push(p);
  }
  return out;
}
