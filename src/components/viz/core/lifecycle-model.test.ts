import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { computeTimeline, type DatedValue } from "@/lib/rules/engine";
import { loadRules } from "@/lib/rules/load";
import { boxesIntersect, formatLifecycleDate, layoutLifecycle, VERTICAL_BELOW, type LcBox, type LifecycleInput } from "./lifecycle-model";
import { textWidth, wrapText } from "./lifecycle-text";

const ev = (key: string, date: string | null, over: Partial<LifecycleInput["events"][number]> = {}) => ({
  key,
  label: key,
  date,
  status: (date ? "ok" : "unknown") as "ok" | "unknown",
  verified: true,
  ...over,
});

const base: LifecycleInput = {
  issueDate: "2023-01-01",
  staleSince: "2023-07-01",
  asOf: "2024-01-01",
  events: [
    ev("remit_due", "2026-06-30"),
    ev("presumed_abandoned", "2026-01-01"),
    ev("report_due", "2026-05-01"),
  ],
};

describe("layoutLifecycle", () => {
  const out = layoutLifecycle(base, 800);
  const dated = out.nodes.filter((n) => n.state !== "unknown");

  it("orders dated nodes by date and increasing x", () => {
    expect(dated.map((n) => n.key)).toEqual(["issued", "stale", "presumed_abandoned", "report_due", "remit_due"]);
    for (let i = 1; i < dated.length; i++) expect(dated[i]!.x).toBeGreaterThanOrEqual(dated[i - 1]!.x);
  });

  it("places today between past and next and ends progress there", () => {
    const stale = dated.find((n) => n.key === "stale")!;
    const next = dated.find((n) => n.state === "next")!;
    expect(next.key).toBe("presumed_abandoned");
    expect(out.todayX).toBeGreaterThan(stale.x);
    expect(out.todayX).toBeLessThan(next.x);
    expect(out.progressEnd).toBe(out.todayX);
    expect(dated.filter((n) => n.state === "past").map((n) => n.key)).toEqual(["issued", "stale"]);
  });

  it("flags urgency only within 7 days", () => {
    const at = (asOf: string) => layoutLifecycle({ ...base, asOf }, 800).nodes.find((n) => n.state === "next")!;
    expect(at("2025-12-25").urgent).toBe(true); // exactly 7 days
    expect(at("2025-12-24").urgent).toBe(false); // 8 days
    expect(at("2025-12-31").urgent).toBe(true);
    expect(at("2024-01-01").urgent).toBe(false);
  });

  it("puts unknown and not-applicable dates in the Unknown lane, never estimated", () => {
    const o = layoutLifecycle(
      { ...base, events: [...base.events, ev("dd_window_start", null), ev("dd_window_end", null, { status: "not_applicable" })] },
      800,
    );
    const unk = o.nodes.filter((n) => n.state === "unknown");
    expect(unk.map((n) => n.key)).toEqual(["dd_window_start", "dd_window_end"]);
    expect(unk.every((n) => n.date === null && !n.urgent)).toBe(true);
    expect(unk[1]!.reason).toBe("not_applicable");
    expect(o.unknownLane).not.toBeNull();
    for (const n of unk) {
      expect(n.x).toBeGreaterThanOrEqual(o.unknownLane!.x0);
      expect(n.x).toBeLessThanOrEqual(o.unknownLane!.x1);
    }
    expect(o.trackEnd).toBeLessThan(o.unknownLane!.x0);
  });

  it("marks unverified events but not issued/stale", () => {
    const o = layoutLifecycle({ ...base, events: [ev("report_due", "2026-05-01", { verified: false })] }, 800);
    expect(o.nodes.find((n) => n.key === "report_due")!.unverified).toBe(true);
    expect(o.nodes.find((n) => n.key === "issued")!.unverified).toBe(false);
  });

  it("has no unknown lane when everything is dated, and stacks stages that share a spot on the rail", () => {
    const o = layoutLifecycle(
      { issueDate: "2024-01-01", asOf: "2024-01-02", events: [ev("a", "2024-01-03"), ev("b", "2024-01-04"), ev("c", "2025-01-01")] },
      600,
    );
    expect(o.unknownLane).toBeNull();
    expect(o.horizontal.fits).toBe(true);
    const nodeLabels = o.horizontal.labels.filter((l) => l.kind === "node");
    expect(nodeLabels.flatMap((l) => l.keys).sort()).toEqual(["a", "b", "c", "issued"]);
  });

  it("stages on the same date share one label, stacked, each with its own date line", () => {
    const o = layoutLifecycle(
      { issueDate: "2022-06-30", asOf: "2026-11-01", events: [ev("report_due", "2028-03-01", { verified: false }), ev("remit_due", "2028-03-01", { verified: false })] },
      570,
    );
    const shared = o.horizontal.labels.find((l) => l.keys.includes("remit_due"))!;
    expect(shared.keys).toEqual(["report_due", "remit_due"]);
    expect(shared.lines.filter((l) => l.role === "date").map((l) => l.text)).toEqual(["Mar 1, 2028", "Mar 1, 2028"]);
    expect(shared.badges).toHaveLength(2);
  });

  it("staggers neighbours that are close but not co-located into different rows", () => {
    const o = layoutLifecycle(
      {
        issueDate: "2024-01-01",
        asOf: "2024-02-01",
        events: ["03", "04", "05", "06", "07"].map((m) => ev(`dd_${m}`, `2025-${m}-01`, { label: "Due-diligence window opens" })),
      },
      520,
    );
    expect(o.horizontal.fits).toBe(true);
    const nodeLabels = o.horizontal.labels.filter((l) => l.kind === "node");
    expect(nodeLabels.length).toBe(6);
    expect(new Set(nodeLabels.map((l) => `${l.side}${l.row}`)).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Label placement on real CA / DE / TX timelines
// ---------------------------------------------------------------------------------------------------------------------

const LABELS = {
  presumed_abandoned: "Presumed abandoned (dormancy ends)",
  dd_window_start: "Due-diligence window opens",
  dd_window_end: "Due-diligence window closes",
  report_due: "Report due",
  remit_due: "Remittance due",
} as const;

function fromEngine(state: string, issueDate: string, staleSince: string, asOf: string): LifecycleInput {
  const t = computeTimeline(
    { propertyType: "vendor_check", lastActivityDate: issueDate as IsoDate, amountCents: 184_250, ownerState: state, holderFiscalYearEnd: "12-31" },
    loadRules(state).file,
  );
  const pick: Record<keyof typeof LABELS, DatedValue | undefined> = {
    presumed_abandoned: t.presumedAbandoned,
    dd_window_start: t.ddWindow.start,
    dd_window_end: t.ddWindow.end,
    report_due: t.reportStages[0]?.due,
    remit_due: t.remitDue,
  };
  return {
    issueDate,
    staleSince,
    asOf,
    events: (Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => {
      const v = pick[key];
      return { key, label: LABELS[key], date: v?.date ?? null, status: v?.status ?? "unknown", verified: v?.verified ?? false };
    }),
  };
}

const CASES: Array<[string, LifecycleInput]> = [
  ["CA engine timeline", fromEngine("CA", "2023-03-14", "2023-09-10", "2026-11-01")],
  ["DE engine timeline", fromEngine("DE", "2022-06-30", "2022-12-27", "2026-11-01")],
  ["TX engine timeline", fromEngine("TX", "2023-01-20", "2023-07-19", "2026-11-01")],
  [
    "crowded hand-built (two dates a day apart, one unverified, one unknown)",
    {
      issueDate: "2023-03-14",
      staleSince: "2023-09-10",
      asOf: "2026-11-01",
      events: [
        ev("presumed_abandoned", "2026-03-14", { label: LABELS.presumed_abandoned }),
        ev("dd_window_start", "2026-05-01", { label: LABELS.dd_window_start, verified: false }),
        ev("dd_window_end", "2026-05-02", { label: LABELS.dd_window_end, verified: false }),
        ev("report_due", "2026-11-01", { label: LABELS.report_due, verified: false }),
        ev("remit_due", null, { label: LABELS.remit_due }),
      ],
    },
  ],
];

const WIDTHS = [280, 375, 570, 900] as const;

function labelBoxes(o: ReturnType<typeof layoutLifecycle>): LcBox[] {
  if (o.orientation === "horizontal") return o.horizontal.labels.map((l) => l.box);
  return [...o.vertical.items, ...o.vertical.unknown].map((i) => i.box);
}

describe("label placement", () => {
  it("the engine produces real dated timelines for CA, DE and TX", () => {
    for (const [, input] of CASES.slice(0, 3)) {
      expect(input.events.filter((e) => e.status === "ok").length).toBeGreaterThanOrEqual(3);
    }
  });

  for (const [name, input] of CASES) {
    for (const width of WIDTHS) {
      it(`${name} @${width}: no two label boxes intersect and every label stays inside the container`, () => {
        const o = layoutLifecycle(input, width, { ticks: true });
        expect(o.orientation).toBe(width < VERTICAL_BELOW ? "vertical" : "horizontal");
        const boxes = labelBoxes(o);
        expect(boxes.length).toBeGreaterThan(0);
        for (let i = 0; i < boxes.length; i++) {
          const a = boxes[i]!;
          expect(a.x0).toBeGreaterThanOrEqual(0);
          expect(a.x1).toBeLessThanOrEqual(width);
          expect(a.y0).toBeGreaterThanOrEqual(0);
          for (let j = i + 1; j < boxes.length; j++) expect(boxesIntersect(a, boxes[j]!), `${i} vs ${j}`).toBe(false);
        }
        if (o.orientation === "horizontal") {
          for (const l of o.horizontal.labels) expect(l.box.y1).toBeLessThanOrEqual(o.horizontal.height);
          // Every stage and TODAY got a label; leaders never run through another label.
          const keys = new Set(o.horizontal.labels.flatMap((l) => (l.kind === "node" ? l.keys : [l.key])));
          for (const n of o.nodes) expect(keys.has(n.key)).toBe(true);
          expect(o.horizontal.labels.filter((l) => l.today)).toHaveLength(1);
          for (const l of o.horizontal.labels) {
            if (!l.leader) continue;
            const seg: LcBox = { x0: l.leader.x - 0.5, x1: l.leader.x + 0.5, y0: Math.min(l.leader.y0, l.leader.y1), y1: Math.max(l.leader.y0, l.leader.y1) };
            for (const other of o.horizontal.labels) if (other !== l) expect(boxesIntersect(seg, other.box), `${l.key} leader vs ${other.key}`).toBe(false);
          }
        }
      });
    }
  }

  it("right-aligns labels pushed in from the right edge and left-aligns those near the left edge", () => {
    const o = layoutLifecycle(CASES[0]![1], 570);
    const labels = o.horizontal.labels.filter((l) => l.kind === "node");
    const issued = labels.find((l) => l.key === "issued")!;
    expect(issued.align).toBe("start");
    expect(issued.box.x0).toBeGreaterThanOrEqual(0);
    const last = labels.reduce((a, l) => (l.leader!.x > a.leader!.x ? l : a));
    expect(last.align).toBe("end");
    expect(last.box.x1).toBeLessThanOrEqual(570);
  });

  it("uses labels above the rail only when below is crowded", () => {
    const sparse = layoutLifecycle({ issueDate: "2020-01-01", asOf: "2021-01-01", events: [ev("report_due", "2024-01-01", { label: "Report due" })] }, 900);
    expect(sparse.horizontal.labels.filter((l) => l.kind === "node").every((l) => l.side === "below")).toBe(true);
    const crowded = layoutLifecycle(CASES[3]![1], 570);
    expect(crowded.horizontal.labels.some((l) => l.kind === "node" && l.side === "above")).toBe(true);
  });

  it("keeps the UNVERIFIED badge on unverified dates, inside the label box", () => {
    const o = layoutLifecycle(CASES[3]![1], 570);
    const badges = o.horizontal.labels.flatMap((l) => l.badges.map((b) => ({ ...b, l })));
    expect(badges).toHaveLength(3);
    for (const { x, y, l } of badges) {
      expect(x).toBeGreaterThanOrEqual(l.box.x0 - 0.01);
      expect(x + 74).toBeLessThanOrEqual(l.box.x1 + 0.01);
      expect(y + 14).toBeLessThanOrEqual(l.box.y1 + 0.01);
    }
  });

  it("vertical layout: date order, TODAY placed by date, rail blue up to TODAY, unknowns last", () => {
    const o = layoutLifecycle(CASES[3]![1], 375);
    expect(o.orientation).toBe("vertical");
    const seq = o.vertical.items.map((i) => (i.kind === "today" ? "TODAY" : i.node.key));
    // asOf 2026-11-01 equals the report date: that stage is already past, TODAY follows it.
    expect(seq).toEqual(["issued", "stale", "presumed_abandoned", "dd_window_start", "dd_window_end", "report_due", "TODAY"]);
    expect(o.vertical.unknown.map((i) => (i.kind === "node" ? i.node.key : ""))).toEqual(["remit_due"]);
    const mid = layoutLifecycle({ ...CASES[3]![1], asOf: "2026-04-01" }, 320).vertical.items;
    const t = mid.findIndex((i) => i.kind === "today");
    expect(mid.map((i) => (i.kind === "today" ? "TODAY" : i.node.key)).slice(t - 1, t + 2)).toEqual(["presumed_abandoned", "TODAY", "dd_window_start"]);
    expect(mid[t]!.segBefore).toBe("past");
    expect(mid[t]!.segAfter).toBe("future");
    expect(mid[0]!.segBefore).toBeNull();
  });

  it("formats dates the same way everywhere (no ISO dates)", () => {
    expect(formatLifecycleDate("2028-09-01")).toBe("Sep 1, 2028");
    expect(formatLifecycleDate("2026-11-01")).toBe("Nov 1, 2026");
  });
});

describe("text metrics", () => {
  it("estimates width from characters, deterministically", () => {
    expect(textWidth("Report due", 12)).toBe(textWidth("Report due", 12));
    expect(textWidth("mmmm", 12)).toBeGreaterThan(textWidth("iiii", 12));
    expect(textWidth("Sep 1, 2028", 11, "mono")).toBe(Math.ceil(11 * 0.6 * 11));
  });

  it("wraps on word boundaries within the limit", () => {
    const lines = wrapText("Presumed abandoned (dormancy ends)", 130, 12);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(textWidth(l, 12)).toBeLessThanOrEqual(130);
    expect(lines.join(" ")).toBe("Presumed abandoned (dormancy ends)");
  });
});
