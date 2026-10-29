/** Shared helpers for the agent CLI scripts. They only call the Next server (PGlite is single-process). */
export const BASE = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

export async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

interface RunView {
  status: "running" | "succeeded" | "failed" | "cancelled";
  phase: string | null;
  mode: string | null;
  error: string | null;
  trace: { at: string; kind: string; message: string; screenshot?: string }[];
  output: Record<string, unknown>;
}

/** Prints new trace steps as they appear; resolves when `stopWhen` is true or the run ends. */
export async function followRun(runId: string, stopWhen: (r: RunView) => boolean = () => false): Promise<RunView> {
  let printed = 0;
  for (;;) {
    const { status, body } = await api<RunView>(`/api/agents/runs/${runId}`);
    if (status !== 200) throw new Error(`GET run ${runId} -> ${status}`);
    for (const s of body.trace.slice(printed)) {
      console.log(`  [${s.at.slice(11, 19)}] ${s.kind.padEnd(13)} ${s.message}${s.screenshot ? `  (${s.screenshot})` : ""}`);
    }
    printed = body.trace.length;
    if (body.status !== "running" || stopWhen(body)) return body;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
