import { describe, expect, it } from "vitest";
import type { IsoDate } from "../dates";
import { nextTransition, type MachineEvent, type MachineItem } from "./machine";

const d = (s: string) => s as IsoDate;
const item = (over: Partial<MachineItem> = {}): MachineItem => ({
  status: "watching",
  ddWindowStart: d("2027-07-04"),
  ddWindowEnd: d("2027-09-02"),
  reportDueDate: d("2027-11-01"),
  remitDueDate: d("2027-11-01"),
  ...over,
});
const types = (r: ReturnType<typeof nextTransition>) => r.actions.map((a) => a.type);

describe("watching", () => {
  it("before the window: stays, wakes at window start", () => {
    const r = nextTransition(item(), d("2027-07-03"));
    expect(r).toMatchObject({ status: "watching", nextWakeAt: "2027-07-04", actions: [], changed: false });
  });
  it("exactly at window start: dd_pending + create task", () => {
    const r = nextTransition(item(), d("2027-07-04"));
    expect(r.status).toBe("dd_pending");
    expect(types(r)).toEqual(["create_outreach_task"]);
    expect(r.nextWakeAt).toBe("2027-09-02");
    expect(r.changed).toBe(true);
  });
  it("late: window already closed => straight to to_report with missed flag", () => {
    const r = nextTransition(item(), d("2027-09-02"));
    expect(r.status).toBe("to_report");
    expect(types(r)).toEqual(["dd_window_missed", "flag_for_report"]);
    expect(r.actions[1]).toMatchObject({ reason: "dd_window_closed" });
  });
  it("past report due date => to_report, report_overdue", () => {
    const r = nextTransition(item(), d("2027-11-02"));
    expect(r.status).toBe("to_report");
    expect(types(r)).toContain("report_overdue");
    expect(r.nextWakeAt).toBeNull();
  });
  it("paid event resolves", () => {
    const r = nextTransition(item(), d("2027-07-01"), [{ type: "paid" }]);
    expect(r).toMatchObject({ status: "resolved_paid", nextWakeAt: null, actions: [] });
  });
});

describe("unknown dates never advance the item", () => {
  it("null window start: stays with needs_rule", () => {
    const r = nextTransition(item({ ddWindowStart: null, ddWindowEnd: null, reportDueDate: null }), d("2030-01-01"));
    expect(r.status).toBe("watching");
    expect(r.actions[0]).toMatchObject({ type: "needs_rule" });
    expect(r.nextWakeAt).toBeNull();
    expect(r.changed).toBe(false);
  });
  it("null start but known report due still honours the report date", () => {
    const r = nextTransition(item({ ddWindowStart: null, ddWindowEnd: null }), d("2027-11-01"));
    expect(r.status).toBe("to_report");
  });
  it("needs_rule stays needs_rule while stuck, recovers when dates arrive", () => {
    const stuck = nextTransition(item({ status: "needs_rule", ddWindowStart: null }), d("2027-07-10"));
    expect(stuck.status).toBe("needs_rule");
    expect(types(stuck)).toContain("needs_rule");
    const ok = nextTransition(item({ status: "needs_rule" }), d("2027-07-10"));
    expect(ok.status).toBe("dd_pending");
    expect(ok.changed).toBe(true);
  });
  it("to_report with null report date: needs_rule, no wake", () => {
    const r = nextTransition(item({ status: "to_report", reportDueDate: null }), d("2027-10-01"));
    expect(r.status).toBe("to_report");
    expect(r.actions).toEqual([{ type: "needs_rule", missing: ["reportDueDate"] }]);
    expect(r.nextWakeAt).toBeNull();
  });
  it("reported with null remit date: needs_rule", () => {
    const r = nextTransition(item({ status: "reported", remitDueDate: null }), d("2027-10-01"));
    expect(r.actions).toEqual([{ type: "needs_rule", missing: ["remitDueDate"] }]);
  });
  it("in outreach with no end and no report date: needs_rule", () => {
    const r = nextTransition(item({ status: "dd_sent", ddWindowEnd: null, reportDueDate: null }), d("2027-08-01"));
    expect(r.status).toBe("dd_sent");
    expect(types(r)).toContain("needs_rule");
  });
});

describe("dd not required", () => {
  it("waits for the report date then flags", () => {
    const i = item({ ddApplies: false, ddWindowStart: null, ddWindowEnd: null });
    expect(nextTransition(i, d("2027-10-31"))).toMatchObject({ status: "watching", nextWakeAt: "2027-11-01" });
    const r = nextTransition(i, d("2027-11-01"));
    expect(r.status).toBe("to_report");
    expect(r.actions[0]).toMatchObject({ type: "flag_for_report", reason: "dd_not_required" });
  });
  it("no report date: needs_rule", () => {
    const r = nextTransition(item({ ddApplies: false, reportDueDate: null }), d("2027-10-31"));
    expect(types(r)).toEqual(["needs_rule"]);
  });
});

describe("outreach states", () => {
  it("pending -> sent on event; sent waits for window end", () => {
    const r = nextTransition(item({ status: "dd_pending" }), d("2027-08-01"), [{ type: "dd_sent" }]);
    expect(r).toMatchObject({ status: "dd_sent", nextWakeAt: "2027-09-02" });
  });
  it("pending with no letter by window end => missed + to_report", () => {
    const r = nextTransition(item({ status: "dd_pending" }), d("2027-09-02"));
    expect(r.status).toBe("to_report");
    expect(types(r)).toEqual(["dd_window_missed", "flag_for_report"]);
  });
  it("sent and unresolved at window end => to_report without missed flag", () => {
    const r = nextTransition(item({ status: "dd_sent" }), d("2027-09-02"), [{ type: "dd_sent" }]);
    expect(r.status).toBe("to_report");
    expect(types(r)).toEqual(["flag_for_report"]);
  });
  it("sent -> owner_responded on confirm_address", () => {
    const ev: MachineEvent[] = [{ type: "dd_sent" }, { type: "owner_responded", response: "confirm_address" }];
    const r = nextTransition(item({ status: "dd_sent" }), d("2027-08-10"), ev);
    expect(r.status).toBe("owner_responded");
    expect(r.nextWakeAt).toBe("2027-09-02");
  });
  it("response arriving while still pending goes straight to owner_responded", () => {
    const r = nextTransition(item({ status: "dd_pending" }), d("2027-08-10"), [{ type: "owner_responded", response: "confirm_address" }]);
    expect(r.status).toBe("owner_responded");
  });
  it("send_money awaits payment; paid resolves", () => {
    const resp: MachineEvent = { type: "owner_responded", response: "send_money" };
    const wait = nextTransition(item({ status: "owner_responded" }), d("2027-08-10"), [resp]);
    expect(types(wait)).toEqual(["await_payment"]);
    const done = nextTransition(item({ status: "owner_responded" }), d("2027-08-10"), [resp, { type: "paid" }]);
    expect(done).toMatchObject({ status: "resolved_paid", actions: [], nextWakeAt: null });
  });
  it("already_cashed asks to verify; paid resolves from dd_sent too", () => {
    const resp: MachineEvent = { type: "owner_responded", response: "already_cashed" };
    expect(types(nextTransition(item({ status: "owner_responded" }), d("2027-08-10"), [resp]))).toEqual(["verify_cashed"]);
    expect(nextTransition(item({ status: "dd_sent" }), d("2027-08-10"), [{ type: "paid" }]).status).toBe("resolved_paid");
  });
  it("uses the latest response", () => {
    const ev: MachineEvent[] = [
      { type: "owner_responded", response: "send_money" },
      { type: "owner_responded", response: "already_cashed" },
    ];
    expect(types(nextTransition(item({ status: "owner_responded" }), d("2027-08-10"), ev))).toEqual(["verify_cashed"]);
  });
  it("owner_responded but unpaid at window end goes to_report", () => {
    const ev: MachineEvent[] = [{ type: "owner_responded", response: "confirm_address" }];
    expect(nextTransition(item({ status: "owner_responded" }), d("2027-09-02"), ev).status).toBe("to_report");
  });
});

describe("report and remit", () => {
  it("to_report waits, then submitted -> reported", () => {
    const wait = nextTransition(item({ status: "to_report" }), d("2027-10-01"));
    expect(wait).toMatchObject({ status: "to_report", nextWakeAt: "2027-11-02", actions: [] });
    const due = nextTransition(item({ status: "to_report" }), d("2027-11-01"));
    expect(due.actions).toEqual([]);
    expect(types(nextTransition(item({ status: "to_report" }), d("2027-11-02")))).toEqual(["report_overdue"]);
    const r = nextTransition(item({ status: "to_report" }), d("2027-10-01"), [{ type: "report_submitted" }]);
    expect(r.status).toBe("reported");
    expect(r.nextWakeAt).toBe("2027-11-02");
  });
  it("reported -> remitted on event, overdue otherwise", () => {
    expect(nextTransition(item({ status: "reported" }), d("2027-10-01"), [{ type: "remitted" }])).toMatchObject({ status: "remitted", nextWakeAt: null });
    expect(types(nextTransition(item({ status: "reported" }), d("2027-11-03")))).toEqual(["remit_overdue"]);
  });
  it("one call can cross submitted and remitted when both events exist", () => {
    const r = nextTransition(item({ status: "to_report" }), d("2027-12-01"), [{ type: "report_submitted" }, { type: "remitted" }]);
    expect(r.status).toBe("remitted");
  });
  it("paid after report flagging still resolves (owner reunited before filing)", () => {
    expect(nextTransition(item({ status: "to_report" }), d("2027-10-01"), [{ type: "paid" }]).status).toBe("resolved_paid");
  });
  it("paid after reported is ignored (property already reported)", () => {
    expect(nextTransition(item({ status: "reported" }), d("2027-10-01"), [{ type: "paid" }]).status).toBe("reported");
  });
});

describe("terminal states and idempotence", () => {
  it.each(["resolved_paid", "remitted"] as const)("%s is terminal", (status) => {
    const r = nextTransition(item({ status }), d("2030-01-01"), [{ type: "paid" }]);
    expect(r).toMatchObject({ status, nextWakeAt: null, actions: [], changed: false });
  });
  it("re-running on the returned status adds no transition actions", () => {
    const now = d("2027-07-10");
    const first = nextTransition(item(), now);
    const second = nextTransition(item({ status: first.status }), now);
    expect(second.status).toBe(first.status);
    expect(second.actions).toEqual([]);
    expect(second.changed).toBe(false);
  });
  it("full journey advancing the clock", () => {
    let status = item().status;
    const events: MachineEvent[] = [];
    const walk = (now: string) => {
      const r = nextTransition(item({ status }), d(now), events);
      status = r.status;
      return r;
    };
    expect(walk("2027-07-04").status).toBe("dd_pending");
    events.push({ type: "dd_sent" });
    expect(walk("2027-07-20").status).toBe("dd_sent");
    expect(walk("2027-09-02").status).toBe("to_report");
    events.push({ type: "report_submitted" });
    expect(walk("2027-10-20").status).toBe("reported");
    events.push({ type: "remitted" });
    expect(walk("2027-10-21").status).toBe("remitted");
  });
});
