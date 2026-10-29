"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  cancelReplicaSubmission,
  checkCredentials,
  createClaim,
  createSessionToken,
  createSubmission,
  getPortalDb,
  getSubmission,
  MAX_UPLOAD_BYTES,
  parsePortal,
  portalHref,
  REPLICA_COOKIE,
  REPLICA_COOKIE_PATH,
  REPLICA_USERNAME,
  ReplicaClaimError,
  ReplicaSubmissionError,
  SESSION_TTL_SECONDS,
  submitReplicaSubmission,
  type Portal,
} from "@/lib/replica/portal";
import { requireHolderSession } from "./_lib/auth";

function portalFrom(formData: FormData, kind: "holder" | "search"): Portal {
  const portal = parsePortal(String(formData.get("portal") ?? ""));
  if (!portal || portal.kind !== kind) redirect("/replica/ca-holder");
  return portal;
}

const withError = (href: string, message: string) => `${href}?error=${encodeURIComponent(message)}`;

export async function loginAction(formData: FormData): Promise<void> {
  const portal = portalFrom(formData, "holder");
  const ok = checkCredentials({ username: formData.get("username"), password: formData.get("password") });
  if (!ok) redirect(withError(portalHref(portal), "The user name or password is incorrect."));
  (await cookies()).set(REPLICA_COOKIE, createSessionToken(REPLICA_USERNAME, portal.state), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_BASE_URL ?? "").startsWith("https://"),
    path: REPLICA_COOKIE_PATH,
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect(portalHref(portal, "dashboard"));
}

export async function logoutAction(formData: FormData): Promise<void> {
  const portal = portalFrom(formData, "holder");
  (await cookies()).delete({ name: REPLICA_COOKIE, path: REPLICA_COOKIE_PATH });
  redirect(portalHref(portal));
}

export async function uploadAction(formData: FormData): Promise<void> {
  const portal = portalFrom(formData, "holder");
  const session = await requireHolderSession(portal);
  const uploadPath = portalHref(portal, "upload");

  const file = formData.get("naupa-file");
  let fileName = "pasted-report.txt";
  let content = String(formData.get("naupa-text") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) redirect(withError(uploadPath, "The file is too large."));
    fileName = file.name || "report.txt";
    content = await file.text();
  }
  if (!content.trim()) redirect(withError(uploadPath, "Choose a .txt file or paste the file contents."));

  let id: string;
  try {
    const db = await getPortalDb();
    const { submission } = await createSubmission(db, {
      state: portal.state,
      holderLogin: session.u,
      fileName,
      content,
    });
    id = submission.id;
  } catch (e) {
    const msg = e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid upload.") : "The upload could not be processed.";
    redirect(withError(uploadPath, msg));
  }
  redirect(portalHref(portal, "review", id));
}

const idField = z.uuid();

export async function approveAction(formData: FormData): Promise<void> {
  const portal = portalFrom(formData, "holder");
  await requireHolderSession(portal);
  const id = idField.parse(String(formData.get("id") ?? ""));
  const reviewPath = portalHref(portal, "review", id);
  const db = await getPortalDb();
  const existing = await getSubmission(db, id);
  if (!existing || existing.state !== portal.state) redirect(withError(portalHref(portal, "dashboard"), "Submission not found."));
  try {
    await submitReplicaSubmission(id, db);
  } catch (e) {
    if (!(e instanceof ReplicaSubmissionError)) throw e;
    if (e.code !== "already_submitted") redirect(withError(reviewPath, e.message));
  }
  redirect(portalHref(portal, "confirmation", id));
}

export async function cancelAction(formData: FormData): Promise<void> {
  const portal = portalFrom(formData, "holder");
  await requireHolderSession(portal);
  const id = idField.parse(String(formData.get("id") ?? ""));
  const db = await getPortalDb();
  const existing = await getSubmission(db, id);
  if (existing && existing.state === portal.state) {
    try {
      await cancelReplicaSubmission(id, db);
    } catch (e) {
      if (!(e instanceof ReplicaSubmissionError)) throw e;
    }
  }
  redirect(withError(portalHref(portal, "dashboard"), "Submission cancelled."));
}

export async function claimAction(formData: FormData): Promise<void> {
  const portal = portalFrom(formData, "search");
  const propertyId = String(formData.get("propertyId") ?? "");
  const claimPath = portalHref(portal, "claim", encodeURIComponent(propertyId));
  let id: string;
  try {
    const claim = await createClaim(await getPortalDb(), {
      state: portal.state,
      propertyId,
      claimantName: String(formData.get("claimantName") ?? ""),
      contact: String(formData.get("contact") ?? ""),
    });
    id = claim.id;
  } catch (e) {
    if (e instanceof z.ZodError) redirect(withError(claimPath, e.issues[0]?.message ?? "Invalid claim."));
    if (e instanceof ReplicaClaimError) redirect(withError(claimPath, e.message));
    throw e;
  }
  redirect(portalHref(portal, "claim-confirmation", id));
}
