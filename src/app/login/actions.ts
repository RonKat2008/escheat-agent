"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionValue, passcodeMatches, safeNextPath, SESSION_COOKIE, SESSION_TTL_MS } from "./gate";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const passcode = process.env.APP_PASSCODE?.trim();
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!passcode) redirect(next); // gate disabled
  const input = String(formData.get("passcode") ?? "");
  if (!passcodeMatches(input, passcode)) return { error: "Incorrect passcode." };
  (await cookies()).set(SESSION_COOKIE, createSessionValue(passcode), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_BASE_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect(next);
}
