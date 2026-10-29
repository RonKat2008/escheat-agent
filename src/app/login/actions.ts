"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { consumeLoginAttempt } from "@/lib/auth/login-limiter";
import { createSessionValue, isProductionLike, passcodeMatches, safeNextPath, SESSION_COOKIE, SESSION_TTL_MS } from "./gate";

export interface LoginState {
  error?: string;
}

async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const passcode = process.env.APP_PASSCODE?.trim();
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!passcode) {
    // Dev: gate disabled. Production: fail closed, never pretend to sign in.
    if (isProductionLike()) return { error: "Set APP_PASSCODE to use this deployment." };
    redirect(next);
  }
  const limit = await consumeLoginAttempt(await getDb(), await clientKey());
  if (!limit.ok) {
    console.warn("[auth] login rate limit hit");
    return { error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` };
  }
  const input = String(formData.get("passcode") ?? "");
  if (!passcodeMatches(input, passcode)) {
    console.warn("[auth] failed login attempt");
    return { error: "Incorrect passcode." };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionValue(passcode), {
    httpOnly: true,
    sameSite: "lax",
    // Secure in any production-like deployment regardless of APP_BASE_URL (M8).
    secure: isProductionLike() || (process.env.APP_BASE_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect(next);
}

/** Ends this browser's session (the cookie is the only credential; rotating SESSION_EPOCH revokes all of them). */
export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
