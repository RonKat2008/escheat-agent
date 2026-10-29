import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type Outreach } from "@/db/schema";
import { withApproval } from "@/lib/approvals";
import { getEnv, type Env } from "@/lib/env";
import type * as LobTypes from "@lob/lob-typescript-sdk";
import { assertLobTestKey } from "./allowlist";
import { OutreachNotConfiguredError, OutreachProviderError } from "./errors";
import { prepareSend, type LetterPayload } from "./payloads";
import { assertSendable, loadOutreach, mergeTracking, previewPath } from "./util";

export interface LobLetterResult {
  id: string;
  /** Signed link to the rendered PDF preview (Lob `url`). */
  url?: string | null;
  expectedDeliveryDate?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
}

export interface SendDeps {
  env?: Env;
  now?: () => Date;
  /** Injected in tests; the default uses @lob/lob-typescript-sdk in test mode. */
  createLetter?: (req: { apiKey: string; payload: LetterPayload; idempotencyKey: string }) => Promise<LobLetterResult>;
}

export interface SendResult {
  outreachId: string;
  channel: Outreach["channel"];
  status: string;
  /** True only when a provider accepted the request. False in offline mode. */
  sent: boolean;
  offline: boolean;
  providerId: string | null;
  previewUrl: string | null;
}

export function toSendResult(row: Outreach, sent: boolean): SendResult {
  return {
    outreachId: row.id,
    channel: row.channel,
    status: row.status,
    sent,
    offline: row.offline,
    providerId: row.providerId,
    previewUrl: row.previewUrl,
  };
}

async function defaultCreateLetter(req: { apiKey: string; payload: LetterPayload; idempotencyKey: string }): Promise<LobLetterResult> {
  const lob = await import("@lob/lob-typescript-sdk");
  const letters = new lob.LettersApi(new lob.Configuration({ username: req.apiKey }));
  const p = req.payload;
  try {
    const letter = await letters.create(
      new lob.LetterEditable({
        description: p.description,
        to: new lob.AddressEditable(p.to),
        from: new lob.AddressEditable(p.from),
        file: p.html,
        color: p.color,
        use_type: lob.LtrUseType.Operational,
        mail_type: p.mailType as unknown as LobTypes.MailType,
        address_placement: p.addressPlacement as unknown as LobTypes.LetterEditableAddressPlacementEnum,
        metadata: { outreach_id: p.outreachId, synthetic: "true" },
      }),
      req.idempotencyKey,
    );
    return {
      id: letter.id,
      url: letter.url ?? null,
      expectedDeliveryDate: letter.expected_delivery_date ?? null,
      carrier: letter.carrier ?? null,
      trackingNumber: letter.tracking_number ?? null,
    };
  } catch (e) {
    throw new OutreachProviderError("lob", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Mail a due-diligence letter through Lob TEST mode. Needs a prior in-app approval of the exact
 * stored payload. Offline mode records a clearly-labeled non-send; it never claims mail went out.
 * `approvedBy` is audit metadata only: it does not grant approval.
 */
export async function sendLetter(
  db: Db,
  outreachId: string,
  approvedBy?: string,
  deps: SendDeps = {},
): Promise<SendResult> {
  const env = deps.env ?? getEnv();
  const now = deps.now ?? (() => new Date());
  const row = await loadOutreach(db, outreachId);
  assertSendable(row, "letter");
  const { payload } = await prepareSend(db, row, { env });
  if (payload.kind !== "letter") throw new Error("unreachable: letter payload expected");

  return withApproval(db, { action: "mail_letter", subjectId: outreachId, payload }, async (approval) => {
    const key = env.LOB_TEST_API_KEY;
    if (key) assertLobTestKey(key); // a live key is refused even in offline mode
    if (env.ESCHEAT_OFFLINE) {
      const [saved] = await db
        .update(outreach)
        .set({
          // The enum has no "offline_not_sent"; "approved" + offline=true is the closest honest state.
          status: "approved",
          offline: true,
          approvalId: approval.id,
          previewUrl: previewPath(outreachId),
          tracking: mergeTracking(row.tracking, {
            offlineResult: { offline: true, sent: false, note: "ESCHEAT_OFFLINE=1: no letter was submitted to Lob.", at: now().toISOString() },
            requestedBy: approvedBy ?? null,
          }),
        })
        .where(eq(outreach.id, outreachId))
        .returning();
      return toSendResult(saved!, false);
    }
    if (!key) throw new OutreachNotConfiguredError("lob", ["LOB_TEST_API_KEY"]);
    const letter = await (deps.createLetter ?? defaultCreateLetter)({
      apiKey: key,
      payload,
      idempotencyKey: `outreach-${outreachId}`,
    });
    const [saved] = await db
      .update(outreach)
      .set({
        status: "sent",
        offline: false,
        sentAt: now(),
        approvalId: approval.id,
        providerId: letter.id,
        previewUrl: letter.url ?? null,
        tracking: mergeTracking(row.tracking, {
          lob: {
            testMode: true,
            id: letter.id,
            expectedDeliveryDate: letter.expectedDeliveryDate ?? null,
            carrier: letter.carrier ?? null,
            trackingNumber: letter.trackingNumber ?? null,
          },
          requestedBy: approvedBy ?? null,
        }),
      })
      .where(eq(outreach.id, outreachId))
      .returning();
    return toSendResult(saved!, true);
  });
}
