/**
 * Settings connection diagram model (DESIGN-V3 §6.15). Pure: the server reads env flags and stored connections into an
 * `IntegrationSnapshot`, and this maps it to nodes, links and honest status labels. Nothing here guesses: a service is
 * only "live" when its keys are present, and the label says exactly what was checked (keys present is not "verified").
 * Snapshots carry booleans and counts only, never a key or secret value.
 */

export interface IntegrationSnapshot {
  /** ESCHEAT_OFFLINE: model answers replay from recordings and sends are simulated. */
  offline: boolean;
  qbo: { configured: boolean; connected: boolean };
  plaid: { configured: boolean; connected: boolean };
  /** keyPresent: any Lob key is set; testKey: it is a Lob test-mode key (the only kind the app will use). */
  lob: { keyPresent: boolean; testKey: boolean };
  /** testRecipient: the allowlisted address an email draft would use first (R3-16), or null when none is set. */
  agentmail: { configured: boolean; testRecipient: string | null; allowlistCount: number };
  vapi: { configured: boolean; allowlistCount: number };
  anthropic: { configured: boolean };
  /** keys: event + signing key set; devMode: the app talks to a local Inngest dev server instead. */
  inngest: { keys: boolean; devMode: boolean };
}

export type ServiceId = "qbo" | "plaid" | "csv" | "lob" | "agentmail" | "vapi" | "anthropic" | "inngest";
export type NodeGroup = "input" | "output" | "engine";

/** How the status reads. `live` = solid blue thread; `simulated` = dotted blue; `off` = dashed fg-4; `blocked` = pink. */
export type LinkState = "live" | "simulated" | "off" | "blocked";

export type NodeStatus =
  | "connected"
  | "not-connected"
  | "available"
  | "test-mode"
  | "configured"
  | "offline"
  | "local"
  | "blocked"
  | "not-configured";

export interface DiagramNode {
  id: ServiceId;
  name: string;
  group: NodeGroup;
  status: NodeStatus;
  statusLabel: string;
  link: LinkState;
  /** One plain sentence on what the status means here. */
  note: string;
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  connected: "Connected",
  "not-connected": "Not connected",
  available: "Available",
  "test-mode": "Test mode",
  configured: "Keys present",
  offline: "Offline replay",
  local: "Local dev mode",
  blocked: "Blocked",
  "not-configured": "Not configured",
};

const LINK_FOR: Record<NodeStatus, LinkState> = {
  connected: "live",
  available: "live",
  "test-mode": "live",
  configured: "live",
  offline: "simulated",
  local: "simulated",
  "not-connected": "off",
  "not-configured": "off",
  blocked: "blocked",
};

function node(id: ServiceId, name: string, group: NodeGroup, status: NodeStatus, note: string): DiagramNode {
  return { id, name, group, status, statusLabel: STATUS_LABEL[status], link: LINK_FOR[status], note };
}

function sourceStatus(s: { configured: boolean; connected: boolean }): NodeStatus {
  if (!s.configured) return "not-configured";
  return s.connected ? "connected" : "not-connected";
}

function lobNode(s: IntegrationSnapshot): DiagramNode {
  const name = "Lob (test mode)";
  if (s.lob.keyPresent && !s.lob.testKey) {
    return node("lob", name, "output", "blocked", "The mail key set up here is not a test-mode key, so every letter is refused.");
  }
  if (s.offline) return node("lob", name, "output", "offline", "Offline mode: letters are simulated and nothing is mailed.");
  if (s.lob.testKey) return node("lob", name, "output", "test-mode", "Letters go to Lob's test mode only. Nothing is printed or mailed.");
  return node("lob", name, "output", "not-configured", "No test-mode mail key is set up, so letters can't be sent.");
}

function agentmailNode(s: IntegrationSnapshot): DiagramNode {
  const name = "AgentMail";
  if (s.offline) return node("agentmail", name, "output", "offline", "Offline mode: emails are simulated and nothing is sent.");
  if (!s.agentmail.configured) return node("agentmail", name, "output", "not-configured", "No email inbox is set up, so emails can't be sent.");
  if (s.agentmail.allowlistCount === 0) {
    return node("agentmail", name, "output", "blocked", "The inbox is set up but no test recipient is approved, so every email is refused.");
  }
  return node("agentmail", name, "output", "configured", "Emails go only to approved test recipients, after approval.");
}

function vapiNode(s: IntegrationSnapshot): DiagramNode {
  const name = "Vapi";
  if (s.offline) return node("vapi", name, "output", "offline", "Offline mode: calls are simulated and nothing is dialed.");
  if (!s.vapi.configured) return node("vapi", name, "output", "not-configured", "No voice provider is set up, so calls can't be placed.");
  if (s.vapi.allowlistCount === 0) {
    return node("vapi", name, "output", "blocked", "The voice provider is set up but no test number is approved, so every call is refused.");
  }
  return node("vapi", name, "output", "configured", "Calls go only to approved test numbers, after approval.");
}

function anthropicNode(s: IntegrationSnapshot): DiagramNode {
  const name = "Anthropic";
  if (s.offline) return node("anthropic", name, "engine", "offline", "Offline mode: chat and drafting replay recorded answers.");
  if (s.anthropic.configured) return node("anthropic", name, "engine", "configured", "Chat, classification and drafting call the model.");
  return node("anthropic", name, "engine", "not-configured", "No model key is set up. Steps that need the model fall back or stop.");
}

function inngestNode(s: IntegrationSnapshot): DiagramNode {
  const name = "Inngest";
  if (s.inngest.keys) return node("inngest", name, "engine", "configured", "Background jobs run on Inngest.");
  if (s.inngest.devMode) return node("inngest", name, "engine", "local", "Background jobs use a local Inngest dev server, if one is running.");
  return node("inngest", name, "engine", "not-configured", "Background jobs are not set up.");
}

/** The diagram's nodes, in display order: inputs (top to bottom), outputs, then the engine row. */
export function buildDiagram(s: IntegrationSnapshot): DiagramNode[] {
  return [
    node("qbo", "QuickBooks Online", "input", sourceStatus(s.qbo), s.qbo.connected ? "Sandbox company connected. Pulls check payments." : s.qbo.configured ? "Sandbox app set up; no company connected yet." : "No QuickBooks sandbox app is set up."),
    node("plaid", "Plaid", "input", sourceStatus(s.plaid), s.plaid.connected ? "Sandbox bank connected. Syncs cleared checks." : s.plaid.configured ? "Sandbox set up; no bank connected yet." : "No Plaid sandbox is set up."),
    node("csv", "CSV upload", "input", "available", "Always available: upload a check register or bank clears below."),
    lobNode(s),
    agentmailNode(s),
    vapiNode(s),
    anthropicNode(s),
    inngestNode(s),
  ];
}

/** Masks the local part of an address for display (demo-recipient@example.com -> de…@example.com). Never empty. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "…";
  const local = address.slice(0, at);
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${keep}…${address.slice(at)}`;
}
