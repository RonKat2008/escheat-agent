import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, type ApprovalAction, type Company, type Outreach } from "@/db/schema";
import { getEnv, type Env } from "@/lib/env";
import { UNKNOWN_LANGUAGE_MARKER } from "@/lib/letters/template";
import { assertAllowedEmail, assertAllowedPhone } from "./allowlist";
import { OutreachNotConfiguredError, OutreachNotFoundError, OutreachNotReadyError } from "./errors";
import { htmlToText } from "./util";

/**
 * The EXACT payloads that get approved and then sent. Both /approve and the channel
 * executors call prepareSend(), so approval hash == send hash unless something changed.
 */

export interface LobAddress {
  name: string;
  address_line1: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_country: "US";
}

export interface LetterPayload {
  kind: "letter";
  outreachId: string;
  description: string;
  to: LobAddress;
  from: LobAddress;
  html: string;
  color: false;
  useType: "operational";
  mailType: "usps_first_class";
  addressPlacement: "insert_blank_page";
}

export interface EmailPayload {
  kind: "email";
  outreachId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface CallPayload {
  kind: "call";
  outreachId: string;
  /** Always a simulated/test call, labeled as such. */
  simulated: true;
  to: string;
  /** Saved Vapi assistant, or null = the inline assistant derived from `script` (see buildInlineAssistant). */
  assistantId: string | null;
  phoneNumberId: string | null;
  script: string;
  dynamicVariables: Record<string, string>;
}

export type SendPayload = LetterPayload | EmailPayload | CallPayload;

export interface PreparedSend {
  action: ApprovalAction;
  payload: SendPayload;
  /** Normalized recipient for email/call. */
  to?: string;
}

export function parseLobAddress(raw: string | null): LobAddress | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<LobAddress>;
    if (a.name && a.address_line1 && a.address_city && a.address_state && a.address_zip) {
      return { ...(a as LobAddress), address_country: "US" };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export function companyFromAddress(c: Company): LobAddress | null {
  if (!c.addressLine || !c.city || !c.hqState || !c.zip) return null;
  return {
    name: c.name,
    address_line1: c.addressLine,
    address_city: c.city,
    address_state: c.hqState,
    address_zip: c.zip,
    address_country: "US",
  };
}

export function buildLetterPayload(row: Outreach, company: Company): LetterPayload {
  const problems: string[] = [];
  if (!row.body) problems.push("letter has no composed body (run draft first)");
  else if (row.body.includes(UNKNOWN_LANGUAGE_MARKER)) {
    problems.push("required state notice language is UNKNOWN for this state (rule TODO); letter is not ready");
  }
  const to = parseLobAddress(row.toAddress);
  if (!to) problems.push("owner mailing address is missing or incomplete");
  const from = companyFromAddress(company);
  if (!from) problems.push("holder return address is missing or incomplete");
  if (problems.length > 0 || !to || !from || !row.body) throw new OutreachNotReadyError(problems);
  return {
    kind: "letter",
    outreachId: row.id,
    description: (row.subject ?? "Due diligence notice").slice(0, 255),
    to,
    from,
    html: row.body,
    color: false,
    useType: "operational",
    mailType: "usps_first_class",
    addressPlacement: "insert_blank_page",
  };
}

export function buildEmailPayload(row: Outreach, to: string, env: Env): EmailPayload {
  // The sender is always the one configured AgentMail inbox; this module never picks or creates an inbox.
  if (!env.AGENTMAIL_INBOX_ID) throw new OutreachNotConfiguredError("agentmail", ["AGENTMAIL_INBOX_ID"]);
  if (!row.body || !row.subject) throw new OutreachNotReadyError(["email has no composed subject/body (run draft first)"]);
  return {
    kind: "email",
    outreachId: row.id,
    from: env.AGENTMAIL_INBOX_ID,
    to,
    subject: row.subject,
    html: row.body,
    text: htmlToText(row.body),
  };
}

export function buildCallPayload(row: Outreach, to: string, env: Env): CallPayload {
  if (!row.body) throw new OutreachNotReadyError(["call has no composed script (run draft first)"]);
  const vars = (row.tracking?.compose as { dynamicVariables?: Record<string, string> } | undefined)?.dynamicVariables ?? {};
  return {
    kind: "call",
    outreachId: row.id,
    simulated: true,
    to,
    assistantId: env.VAPI_ASSISTANT_ID ?? null,
    phoneNumberId: env.VAPI_PHONE_NUMBER_ID ?? null,
    script: row.body,
    dynamicVariables: vars,
  };
}

/**
 * Build the approval payload for an outreach row. Email/call recipients are checked against
 * the allowlist HERE, before approval is recorded or any API is touched (HARD RULE 4).
 */
export async function prepareSend(
  db: Db,
  row: Outreach,
  opts: { to?: string | null; env?: Env } = {},
): Promise<PreparedSend> {
  const env = opts.env ?? getEnv();
  switch (row.channel) {
    case "letter": {
      const [company] = await db.select().from(companies).where(eq(companies.id, row.companyId));
      if (!company) throw new OutreachNotFoundError("Company", row.companyId);
      return { action: "mail_letter", payload: buildLetterPayload(row, company) };
    }
    case "email": {
      const to = assertAllowedEmail(opts.to ?? row.toAddress ?? "", env);
      return { action: "send_email", payload: buildEmailPayload(row, to, env), to };
    }
    case "voice": {
      const to = assertAllowedPhone(opts.to ?? row.toAddress ?? "", env);
      return { action: "place_call", payload: buildCallPayload(row, to, env), to };
    }
  }
}
