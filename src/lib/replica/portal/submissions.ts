import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { getPortalDb } from "./db";
import { replicaSubmissions, type ReplicaSubmission } from "@/db/schema";
import { makeConfirmationNumber } from "./confirmation";
import { hasBlockingProblems, parseNaupaUpload, uploadSchema, type NaupaUploadSummary } from "./naupa-adapter";
import { stateSchema } from "./portals";

export class ReplicaSubmissionError extends Error {
  constructor(
    public readonly code: "not_found" | "already_submitted" | "has_errors" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "ReplicaSubmissionError";
  }
}

const createInput = z.object({
  state: stateSchema,
  holderLogin: z.string().trim().min(1).max(100),
  fileName: z.string(),
  content: z.string(),
});
export type CreateSubmissionInput = z.input<typeof createInput>;

const idSchema = z.uuid();

/** Parse + summarize an upload and store it. Clean files wait for approval; files with errors stay "uploaded". */
export async function createSubmission(
  db: Db,
  input: CreateSubmissionInput,
): Promise<{ submission: ReplicaSubmission; summary: NaupaUploadSummary }> {
  const { state, holderLogin, ...file } = createInput.parse(input);
  const upload = uploadSchema.parse(file);
  const summary = parseNaupaUpload(upload.content);
  const [row] = await db
    .insert(replicaSubmissions)
    .values({
      state,
      holderName: summary.holderName ?? "(unreadable)",
      holderLogin,
      fileName: upload.fileName,
      fileContent: upload.content,
      parsedSummary: summary as unknown as Record<string, unknown>,
      itemCount: summary.itemCount,
      totalCents: summary.totalCents,
      status: hasBlockingProblems(summary) ? "uploaded" : "awaiting_approval",
    })
    .returning();
  return { submission: row!, summary };
}

export async function getSubmission(db: Db, id: string): Promise<ReplicaSubmission | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return null;
  const [row] = await db.select().from(replicaSubmissions).where(eq(replicaSubmissions.id, parsed.data));
  return row ?? null;
}

export function summaryOf(submission: ReplicaSubmission): NaupaUploadSummary | null {
  return (submission.parsedSummary as unknown as NaupaUploadSummary | null) ?? null;
}

/**
 * Finalize a submission: awaiting_approval -> submitted with a confirmation number.
 * The caller (Approve button, or the filing agent after in-app human approval) owns authorization.
 * The conditional UPDATE makes double-submits impossible even under concurrency.
 */
export async function submitReplicaSubmission(id: string, db?: Db): Promise<ReplicaSubmission> {
  db ??= await getPortalDb();
  const existing = await getSubmission(db, id);
  if (!existing) throw new ReplicaSubmissionError("not_found", "Submission not found.");
  if (existing.status === "submitted") {
    throw new ReplicaSubmissionError("already_submitted", "This submission was already submitted.");
  }
  if (existing.status !== "awaiting_approval") {
    throw new ReplicaSubmissionError(
      existing.status === "uploaded" ? "has_errors" : "invalid_state",
      existing.status === "uploaded"
        ? "This file has validation errors and cannot be submitted."
        : `Submission is ${existing.status}.`,
    );
  }
  const [row] = await db
    .update(replicaSubmissions)
    .set({
      status: "submitted",
      confirmationNumber: makeConfirmationNumber(existing.state),
      submittedAt: new Date(),
    })
    .where(and(eq(replicaSubmissions.id, existing.id), eq(replicaSubmissions.status, "awaiting_approval")))
    .returning();
  if (!row) throw new ReplicaSubmissionError("already_submitted", "This submission was already submitted.");
  return row;
}

/** Cancel (reject) a not-yet-submitted submission. */
export async function cancelReplicaSubmission(id: string, db?: Db): Promise<ReplicaSubmission> {
  db ??= await getPortalDb();
  const existing = await getSubmission(db, id);
  if (!existing) throw new ReplicaSubmissionError("not_found", "Submission not found.");
  if (existing.status === "submitted") {
    throw new ReplicaSubmissionError("already_submitted", "A submitted report cannot be cancelled.");
  }
  const [row] = await db
    .update(replicaSubmissions)
    .set({ status: "rejected" })
    .where(and(eq(replicaSubmissions.id, existing.id), eq(replicaSubmissions.status, existing.status)))
    .returning();
  return row ?? existing;
}
