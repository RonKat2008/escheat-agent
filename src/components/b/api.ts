/** Tiny client-side JSON POST helper that never throws and keeps the server's error shape. */
export interface ApiFailure {
  ok: false;
  status: number;
  error: string;
  code?: string;
  missing?: string[];
  service?: string;
  problems?: string[];
  /** 409 already_approved (R11-02): who already approved it. */
  approvedBy?: string;
  /** In-app path the error refers to (e.g. the remittance already recorded). Same-origin paths only. */
  href?: string;
}
export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return {
      ok: false,
      status: res.status,
      error: typeof json.error === "string" ? json.error : `Request failed (${res.status})`,
      code: typeof json.code === "string" ? json.code : undefined,
      missing: Array.isArray(json.missing) ? (json.missing as string[]) : undefined,
      service: typeof json.service === "string" ? json.service : undefined,
      problems: Array.isArray(json.problems) ? (json.problems as string[]) : undefined,
      approvedBy: typeof json.approvedBy === "string" ? json.approvedBy : undefined,
      href: typeof json.href === "string" && json.href.startsWith("/") && !json.href.startsWith("//") ? json.href : undefined,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Network error", code: "network" };
  }
}

export async function getJson<T = Record<string, unknown>>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return { ok: false, status: res.status, error: typeof json.error === "string" ? json.error : `Request failed (${res.status})` };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Network error", code: "network" };
  }
}
