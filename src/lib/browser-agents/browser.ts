import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { assertReplicaUrl, fencePlaywrightContext, NonReplicaUrlError, type RoutableContext } from "@/lib/replica/guard";
import type { RunRecorder } from "./recorder";

export function appBaseUrl(): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  return fromEnv && fromEnv !== "" ? fromEnv : `http://localhost:${process.env.PORT ?? 3000}`;
}

/** Minimal surface used by guardedGoto so tests can pass a fake page. */
export interface NavigablePage {
  goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<unknown>;
  url(): string;
}

/**
 * The ONLY way agents navigate. Asserts the target is a replica URL before the request is made,
 * logs refusals to the run trace, and re-checks where the page actually landed (aborted or redirected navs).
 */
export async function guardedGoto(page: NavigablePage, url: string, baseUrl: string, rec?: Pick<RunRecorder, "step">): Promise<void> {
  try {
    assertReplicaUrl(url, baseUrl);
  } catch (err) {
    if (err instanceof NonReplicaUrlError) {
      await rec?.step("guard_blocked", `Refused to navigate: ${err.message}`, { data: { url, why: err.why } });
    }
    throw err;
  }
  await page.goto(url, { waitUntil: "load" });
  const landed = page.url();
  if (landed !== "about:blank") {
    try {
      assertReplicaUrl(landed, baseUrl);
    } catch (err) {
      await rec?.step("guard_blocked", `Page landed off-replica after navigation: ${landed}`, { data: { url: landed } });
      throw err;
    }
  }
}

export interface FencedBrowser {
  context: BrowserContext;
  page: Page;
  /** CDP websocket for attaching Stagehand. */
  cdpUrl: string;
  blocked: string[];
  videoPath(): Promise<string | undefined>;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Playwright owns the browser: headless by default (AGENT_HEADED=1 shows it), replica network fence on the
 * whole context, video recorded into videoDir, remote debugging on 127.0.0.1 for Stagehand to attach.
 */
export async function launchFencedBrowser(opts: { baseUrl: string; videoDir: string; rec?: Pick<RunRecorder, "step"> }): Promise<FencedBrowser> {
  const { chromium } = await import("playwright");
  const port = await freePort();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "escheat-agent-ud-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.AGENT_HEADED !== "1",
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: opts.videoDir, size: { width: 1280, height: 720 } },
    args: [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
  });
  const { blocked } = await fencePlaywrightContext(context as unknown as RoutableContext, opts.baseUrl, (m) => {
    void opts.rec?.step("guard_blocked", m);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl: string };
  return {
    context,
    page,
    cdpUrl: webSocketDebuggerUrl,
    blocked,
    videoPath: async () => {
      try {
        return await page.video()?.path();
      } catch {
        return undefined;
      }
    },
    close: async () => {
      await context.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
