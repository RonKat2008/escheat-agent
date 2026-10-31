import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UiPayload } from "@/lib/chat/ui-types";
import { findPinned } from "./ChatApp";
import { AssistantMessage } from "./Messages";
import { applyEvent, type AssistantTurn, type Turn } from "./use-chat";
import { elapsedLabel, visibleSteps } from "./views/SystemViews";

const base: AssistantTurn = { id: "a1", role: "assistant", parts: [], status: "streaming" };

const render = (turn: AssistantTurn) => renderToStaticMarkup(createElement(AssistantMessage, { turn, isLast: true, onRetry: () => undefined, canRetry: true }));

describe("offline replay badge", () => {
  it("the start event's offline flag is kept on the turn", () => {
    expect(applyEvent(base, { type: "start", model: "m", runId: null, offline: true }).offline).toBe(true);
    expect(applyEvent(base, { type: "start", model: "m", runId: null, offline: false }).offline).toBe(false);
  });

  it("labels every replayed answer, and only replayed ones", () => {
    const answered = (offline: boolean): AssistantTurn => ({ ...base, status: "done", offline, parts: [{ type: "text", text: "You owe **$61,915.00**." }] });
    expect(render(answered(true))).toContain("Offline replay");
    expect(render(answered(false))).not.toContain("Offline replay");
    // Even an answer with no text (a failed replay) carries the label.
    expect(render({ ...base, status: "error", offline: true, error: { code: "offline_unavailable", message: "No recording." } })).toContain("Offline replay");
  });
});

describe("pin to side panel", () => {
  const ui: UiPayload = { kind: "link", props: { href: "/rules", title: "Rules", description: "d" } };
  const turns: Turn[] = [
    { id: "u", role: "user", text: "q" },
    { ...base, status: "done", parts: [{ type: "tool", id: "t1", name: "open_view", label: "Linking", status: "done", ui }] },
  ];

  it("resolves a pinned id to its tool part and forgets ids no longer in the conversation", () => {
    expect(findPinned(turns, "t1")?.ui).toEqual(ui);
    expect(findPinned(turns, "gone")).toBeNull();
    expect(findPinned(turns, null)).toBeNull();
  });
});

describe("agent run live progress", () => {
  it("hides the dev server's fenced HMR socket but keeps real guard blocks", () => {
    const steps = visibleSteps([
      { kind: "guard_blocked", message: "[replica-fence] closed websocket ws://localhost:3151/_next/hmr?id=x" },
      { kind: "guard_blocked", message: "[replica-fence] blocked http://localhost:3151/__nextjs_font/geist-latin.woff2" },
      { kind: "action", message: "TX: searched" },
      { kind: "guard_blocked", message: "[replica-fence] blocked https://real-state.gov/x" },
      { kind: "info" },
    ]);
    expect(steps.map((s) => s.message)).toEqual(["TX: searched", "[replica-fence] blocked https://real-state.gov/x"]);
  });

  it("formats elapsed time as m:ss and never goes negative", () => {
    expect(elapsedLabel(0, 65_400)).toBe("1:05");
    expect(elapsedLabel(10_000, 0)).toBe("0:00");
  });
});
