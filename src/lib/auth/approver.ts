import { z } from "zod";

/**
 * R5-10: one approver identity rule for every human gate. The name is typed by the person (never prefilled), at least
 * two characters, and every approval endpoint validates it with this one schema so a blank name is refused everywhere.
 */
export const APPROVER_MIN_CHARS = 2;
export const APPROVER_MAX_CHARS = 80;
export const APPROVER_REQUIRED_MESSAGE = `Enter your name (${APPROVER_MIN_CHARS}+ characters)`;

export const approverNameSchema = z.string().trim().min(APPROVER_MIN_CHARS, APPROVER_REQUIRED_MESSAGE).max(APPROVER_MAX_CHARS);

export const isValidApproverName = (name: string): boolean => approverNameSchema.safeParse(name).success;
