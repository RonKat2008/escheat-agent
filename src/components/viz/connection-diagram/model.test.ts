import { describe, expect, it } from "vitest";
import { placeNodes, VIEW_H, VIEW_W, NODE_H, NODE_W } from "./layout";
import { buildDiagram, maskEmail, STATUS_LABEL, type IntegrationSnapshot, type ServiceId } from "./model";

const NOTHING: IntegrationSnapshot = {
  offline: false,
  qbo: { configured: false, connected: false },
  plaid: { configured: false, connected: false },
  lob: { keyPresent: false, testKey: false },
  agentmail: { configured: false, testRecipient: null, allowlistCount: 0 },
  vapi: { configured: false, allowlistCount: 0 },
  anthropic: { configured: false },
  inngest: { keys: false, devMode: false },
};

const with_ = (patch: Partial<IntegrationSnapshot>): IntegrationSnapshot => ({ ...NOTHING, ...patch });
const byId = (s: IntegrationSnapshot) => Object.fromEntries(buildDiagram(s).map((n) => [n.id, n])) as Record<ServiceId, ReturnType<typeof buildDiagram>[number]>;

describe("buildDiagram", () => {
  it("lists every service once, grouped as sources, outputs and engine", () => {
    const nodes = buildDiagram(NOTHING);
    expect(nodes.map((n) => n.id)).toEqual(["qbo", "plaid", "csv", "lob", "agentmail", "vapi", "anthropic", "inngest"]);
    expect(nodes.filter((n) => n.group === "input").map((n) => n.id)).toEqual(["qbo", "plaid", "csv"]);
    expect(nodes.filter((n) => n.group === "engine").map((n) => n.id)).toEqual(["anthropic", "inngest"]);
  });

  it("with nothing configured, every service except CSV upload says Not configured and draws a dashed (off) link", () => {
    const nodes = buildDiagram(NOTHING);
    for (const n of nodes.filter((x) => x.id !== "csv")) {
      expect(n.status, n.id).toBe("not-configured");
      expect(n.statusLabel).toBe("Not configured");
      expect(n.link).toBe("off");
    }
    expect(byId(NOTHING).csv).toMatchObject({ status: "available", link: "live" });
  });

  it("sources: configured without a stored token is Not connected, with one is Connected", () => {
    expect(byId(with_({ qbo: { configured: true, connected: false } })).qbo).toMatchObject({ status: "not-connected", link: "off" });
    expect(byId(with_({ plaid: { configured: true, connected: true } })).plaid).toMatchObject({ status: "connected", link: "live" });
  });

  it("Lob: a test key is Test mode; a non-test key is Blocked (pink), never live", () => {
    expect(byId(with_({ lob: { keyPresent: true, testKey: true } })).lob).toMatchObject({ status: "test-mode", link: "live" });
    expect(byId(with_({ lob: { keyPresent: true, testKey: false } })).lob).toMatchObject({ status: "blocked", link: "blocked" });
    // A live key stays blocked even in offline mode: it is a config problem a person must fix.
    expect(byId(with_({ offline: true, lob: { keyPresent: true, testKey: false } })).lob.status).toBe("blocked");
  });

  it("AgentMail and Vapi with keys but no approved test recipient/number are Blocked", () => {
    const s = with_({ agentmail: { configured: true, testRecipient: null, allowlistCount: 0 }, vapi: { configured: true, allowlistCount: 0 } });
    expect(byId(s).agentmail.status).toBe("blocked");
    expect(byId(s).vapi.status).toBe("blocked");
  });

  it("keys present reads as 'Keys present', not as a verified connection", () => {
    const s = with_({ agentmail: { configured: true, testRecipient: "a@b.test", allowlistCount: 1 }, anthropic: { configured: true }, inngest: { keys: true, devMode: false } });
    for (const id of ["agentmail", "anthropic", "inngest"] as const) {
      expect(byId(s)[id]).toMatchObject({ status: "configured", statusLabel: "Keys present", link: "live" });
    }
    expect(STATUS_LABEL.configured).not.toMatch(/connected/i);
  });

  it("offline mode marks outbound and model services as simulated (Offline replay)", () => {
    const s = with_({ offline: true, anthropic: { configured: true }, lob: { keyPresent: true, testKey: true } });
    for (const id of ["lob", "agentmail", "vapi", "anthropic"] as const) {
      expect(byId(s)[id]).toMatchObject({ status: "offline", link: "simulated" });
    }
  });

  it("Inngest without keys in dev is Local dev mode (simulated)", () => {
    expect(byId(with_({ inngest: { keys: false, devMode: true } })).inngest).toMatchObject({ status: "local", statusLabel: "Local dev mode", link: "simulated" });
  });

  it("never puts a config name in a label or note", () => {
    const all = [NOTHING, with_({ offline: true }), with_({ lob: { keyPresent: true, testKey: false } })].flatMap(buildDiagram);
    for (const n of all) expect(`${n.statusLabel} ${n.note}`).not.toMatch(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/);
  });
});

describe("maskEmail", () => {
  it("keeps the domain and two leading characters", () => {
    expect(maskEmail("demo-recipient@example.com")).toBe("de…@example.com");
    expect(maskEmail("ab@x.io")).toBe("a…@x.io");
    expect(maskEmail("not-an-address")).toBe("…");
  });
});

describe("placeNodes", () => {
  it("keeps every node inside the viewBox and gives each a link path", () => {
    for (const n of placeNodes(buildDiagram(NOTHING))) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + NODE_W).toBeLessThanOrEqual(VIEW_W);
      expect(n.y + NODE_H).toBeLessThanOrEqual(VIEW_H);
      expect(n.d).toMatch(/^M[\d.]+ [\d.]+C/);
    }
  });

  it("does not overlap nodes", () => {
    const p = placeNodes(buildDiagram(NOTHING));
    for (const a of p)
      for (const b of p) {
        if (a === b) continue;
        const overlap = a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
  });
});
