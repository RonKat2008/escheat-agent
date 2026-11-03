import { describe, expect, it } from "vitest";
import { findGroup, groupQueue, sequenceOf } from "./group";
import type { OutreachView, QueueEntry } from "./queue-data";

function outreachEntry(id: string, item: string, channel: OutreachView["channel"], actionable: boolean): QueueEntry {
  return {
    key: `o:${id}`,
    kind: channel,
    title: `t ${id}`,
    subtitle: "",
    amountCents: 100,
    state: "CA",
    dueDate: null,
    dueLabel: null,
    statusKey: actionable ? "draft" : "sent",
    actionable,
    outreach: { id, channel, staleItemId: item } as OutreachView,
  };
}

const report = (id: string): QueueEntry => ({
  key: `r:${id}`,
  kind: "report",
  title: "r",
  subtitle: "",
  amountCents: 1,
  state: "CA",
  dueDate: null,
  dueLabel: null,
  statusKey: "awaiting_approval",
  actionable: true,
});

describe("groupQueue (R3-13: one row per owner, channel sequence letter → email → call)", () => {
  it("puts an owner's letter, email and call drafts in one row in sequence order", () => {
    const entries = [outreachEntry("v1", "A", "voice", true), outreachEntry("e1", "A", "email", true), outreachEntry("l1", "A", "letter", true)];
    const groups = groupQueue(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("g:A");
    expect(groups[0]!.members.map((m) => m.outreach!.channel)).toEqual(["letter", "email", "voice"]);
    expect(groups[0]!.lead.key).toBe("o:l1");
    expect(groups[0]!.waiting).toBe(3);
  });

  it("leads with the first channel that still waits on a person", () => {
    const groups = groupQueue([outreachEntry("e1", "A", "email", true), outreachEntry("l1", "A", "letter", false)]);
    expect(groups[0]!.lead.key).toBe("o:e1");
    expect(groups[0]!.actionable).toBe(true);
    expect(groups[0]!.waiting).toBe(1);
  });

  it("keeps different owners and non-outreach entries apart, in first-appearance order", () => {
    const groups = groupQueue([outreachEntry("l1", "A", "letter", true), report("x"), outreachEntry("l2", "B", "letter", true), outreachEntry("e1", "A", "email", true)]);
    expect(groups.map((g) => g.id)).toEqual(["g:A", "r:x", "g:B"]);
  });

  it("a handled-only group is not actionable and leads with its first member", () => {
    const groups = groupQueue([outreachEntry("l1", "A", "letter", false)]);
    expect(groups[0]).toMatchObject({ actionable: false, waiting: 0 });
    expect(groups[0]!.lead.key).toBe("o:l1");
  });

  it("findGroup resolves a member key or a group id; sequenceOf prefers the pending row of a channel", () => {
    const groups = groupQueue([outreachEntry("l2", "A", "letter", true), outreachEntry("l1", "A", "letter", false), outreachEntry("e1", "A", "email", true)]);
    expect(findGroup(groups, "o:e1")?.id).toBe("g:A");
    expect(findGroup(groups, "g:A")?.id).toBe("g:A");
    expect(findGroup(groups, "o:nope")).toBeUndefined();
    const seq = sequenceOf(groups[0]!);
    expect(seq.letter?.key).toBe("o:l2");
    expect(seq.email?.key).toBe("o:e1");
    expect(seq.voice).toBeUndefined();
  });
});
