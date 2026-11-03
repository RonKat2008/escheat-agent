/**
 * R3-14: the finance UI never shows developer or config text (env-var names, "not set", file names) as the message.
 * Raw config messages are turned into plain operator language; the raw text survives only as `technical`, which the
 * UI renders inside a collapsed "Technical details" disclosure. Secret values are never part of either string.
 *
 * Pure: no env reads, no I/O. Safe to import from client and server code.
 */

export interface OperatorMessage {
  /** What happened, for a finance user. Never contains a config name. */
  plain: string;
  /** The underlying config detail (may name a variable, never its value). Undefined when there is nothing to add. */
  technical?: string;
}

/** Config-style names: SHOUTY_SNAKE with at least one underscore (APP_BASE_URL, OWNER_LINK_SECRET). */
const CONFIG_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const CONFIG_NAME_GLOBAL = new RegExp(CONFIG_NAME.source, "g");
/** NAME=value where NAME looks secret-bearing. The value is dropped. */
const SECRET_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSCODE|PASSWORD)[A-Z0-9_]*)\s*=\s*\S+/g;

export function containsConfigName(text: string): boolean {
  return CONFIG_NAME.test(text);
}

/** Every config-style name in `text`, de-duplicated, in order of first appearance. */
export function configNamesIn(text: string): string[] {
  return [...new Set(text.match(CONFIG_NAME_GLOBAL) ?? [])];
}

/** Removes the value from any `SECRET_NAME=value` pair so a technical detail can never print a secret. */
export function redactSecretValues(text: string): string {
  return text.replace(SECRET_ASSIGNMENT, "$1=(hidden)");
}

interface Rule {
  match: RegExp;
  plain: string;
}

/** Ordered: the first match wins. Each `plain` is written for the person approving letters, not for a developer. */
const RULES: readonly Rule[] = [
  {
    match: /QBO_TOKEN_SECRET|Token encryption secret/i,
    plain: "Connections can't be saved yet: no encryption key is set up for stored sign-ins. Ask whoever runs this deployment.",
  },
  {
    match: /OWNER_LINK_SECRET/,
    plain:
      "Owner reply links are signed with a temporary key, so links sent now stop working when the app restarts. Fine for a demo; set a permanent key before real use.",
  },
  {
    match: /APP_BASE_URL/,
    plain:
      "Owner reply links point at the address this app is open on right now. Set a fixed public address before anything is sent for real.",
  },
  {
    match: /ALLOWED_TEST_RECIPIENTS/,
    plain: "Email sending is limited to test addresses. Add one in Settings → Connections.",
  },
  {
    match: /ALLOWED_TEST_PHONES/,
    plain: "Calls are limited to test numbers. Add one in Settings → Connections.",
  },
  {
    match: /APP_PASSCODE/,
    plain: "Sign-in isn't set up on this deployment yet. Ask the demo operator.",
  },
  {
    match: /LOB_TEST_API_KEY|live Lob|Lob test key/i,
    plain: "Mail is blocked: this prototype only sends through the mail provider's test mode, and no test key is set up.",
  },
];

const GENERIC_PLAIN = "This needs a setting that the person running this deployment controls. Technical details name it.";

/** Maps one raw message (a warning, an API error) to operator language plus an optional technical detail. */
export function toOperatorMessage(raw: string): OperatorMessage {
  const text = raw.trim();
  if (!containsConfigName(text)) return { plain: text };
  const technical = redactSecretValues(text);
  const rule = RULES.find((r) => r.match.test(text));
  return { plain: rule?.plain ?? GENERIC_PLAIN, technical };
}

/** Owner reply-link readiness, as booleans read on the server (never the secret itself). */
export interface OwnerLinkState {
  secretSet: boolean;
  baseUrlSet: boolean;
}

export interface OwnerLinkNotice {
  id: "signing-key" | "public-address";
  ok: boolean;
  title: string;
  plain: string;
  /** Lead-in for the Technical details disclosure. */
  technical: string;
  /** The one config name the disclosure may show. */
  configName: string;
}

/** R3-14: the two owner-link settings, in operator language first, config name only as technical detail. */
export function ownerLinkNotices(state: OwnerLinkState): OwnerLinkNotice[] {
  return [
    {
      id: "signing-key",
      ok: state.secretSet,
      title: "Owner reply links",
      plain: state.secretSet
        ? "Signed with a permanent key, so links keep working after the app restarts."
        : "Signed with a temporary key, so links sent now stop working when the app restarts. Fine for a demo; set a permanent key before real use.",
      technical: state.secretSet ? "The signing key is set (its value is never shown):" : "The signing key is not set. Set it (16 characters or more) in:",
      configName: "OWNER_LINK_SECRET",
    },
    {
      id: "public-address",
      ok: state.baseUrlSet,
      title: "Link address",
      plain: state.baseUrlSet
        ? "Owner reply links use this deployment's fixed public address."
        : "Owner reply links point at the address this app is open on right now. Set a fixed public address before anything is sent for real.",
      technical: state.baseUrlSet ? "The public address is set in:" : "The public address is not set. Set it in:",
      configName: "APP_BASE_URL",
    },
  ];
}
