"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_LIMITS, decodeEvents, type ChatErrorCode, type ChatEvent, type ChatMessage, type ChatUsage, type UiPayload } from "@/lib/chat/protocol";

export type ToolPart = { type: "tool"; id: string; name: string; label: string; status: "running" | "done" | "error"; summary?: string; ui?: UiPayload };
export type TextPart = { type: "text"; text: string };
export type Part = TextPart | ToolPart;

export interface UserTurn {
  id: string;
  role: "user";
  text: string;
}

export interface AssistantTurn {
  id: string;
  role: "assistant";
  parts: Part[];
  status: "streaming" | "done" | "error" | "stopped";
  error?: { code: ChatErrorCode | "network"; message: string };
  toolContext?: string;
  usage?: ChatUsage;
  runId?: string | null;
  /** The server replayed a recorded answer (ESCHEAT_OFFLINE); the UI labels the turn so nobody mistakes it for a live one. */
  offline?: boolean;
}

export type Turn = UserTurn | AssistantTurn;

const STORAGE_KEY = "escheat.chat.v1";
/** Keep stored history bounded; ui payloads can be large. */
const MAX_STORED_CHARS = 1_500_000;

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function assistantText(turn: AssistantTurn): string {
  return turn.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

/** Most recent turns that fit the server's limits, starting with a user turn. */
export function toRequestMessages(turns: Turn[]): ChatMessage[] {
  const msgs: ChatMessage[] = turns.flatMap((t): ChatMessage[] => {
    if (t.role === "user") return [{ role: "user", text: t.text }];
    if (t.status === "streaming") return [];
    const text = assistantText(t).slice(0, CHAT_LIMITS.maxAssistantChars);
    return [{ role: "assistant", text: text || (t.error ? `(no answer: ${t.error.message})` : "(no reply)"), ...(t.toolContext ? { toolContext: t.toolContext } : {}) }];
  });
  let kept = msgs.slice(-(CHAT_LIMITS.maxMessages - 1));
  const size = (m: ChatMessage[]) => m.reduce((n, x) => n + x.text.length + (x.role === "assistant" ? (x.toolContext?.length ?? 0) : 0), 0);
  while (kept.length > 1 && size(kept) > CHAT_LIMITS.maxTotalChars * 0.9) kept = kept.slice(1);
  while (kept.length > 0 && kept[0]!.role !== "user") kept = kept.slice(1);
  return kept;
}

/** Folds one stream event into the assistant turn (pure; exported for tests). */
export function applyEvent(turn: AssistantTurn, e: ChatEvent): AssistantTurn {
  switch (e.type) {
    case "start":
      return { ...turn, runId: e.runId, offline: e.offline === true };
    case "text": {
      const last = turn.parts.at(-1);
      if (last?.type === "text") return { ...turn, parts: [...turn.parts.slice(0, -1), { type: "text", text: last.text + e.delta }] };
      // A separator right after a tool card is noise.
      const delta = last?.type === "tool" ? e.delta.replace(/^\n+/, "") : e.delta;
      return delta ? { ...turn, parts: [...turn.parts, { type: "text", text: delta }] } : turn;
    }
    case "tool_start":
      return { ...turn, parts: [...turn.parts, { type: "tool", id: e.id, name: e.name, label: e.label, status: "running" }] };
    case "tool_result":
      return {
        ...turn,
        parts: turn.parts.map((p) => (p.type === "tool" && p.id === e.id ? { ...p, status: e.ok ? "done" : "error", summary: e.summary, ui: e.ui } : p)),
      };
    case "error":
      return { ...turn, status: e.code === "aborted" ? "stopped" : "error", error: { code: e.code, message: e.message } };
    case "done":
      return { ...turn, status: turn.status === "streaming" ? "done" : turn.status, toolContext: e.toolContext, usage: e.usage, runId: e.runId };
  }
}

function load(): Turn[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const turns = JSON.parse(raw) as Turn[];
    // A turn that was streaming when the tab reloaded cannot resume.
    return turns.map((t) => (t.role === "assistant" && t.status === "streaming" ? { ...t, status: "stopped" } : t));
  } catch {
    return [];
  }
}

function save(turns: Turn[]) {
  try {
    let list = turns;
    let json = JSON.stringify(list);
    while (json.length > MAX_STORED_CHARS && list.length > 2) {
      list = list.slice(2);
      json = JSON.stringify(list);
    }
    sessionStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* storage full or blocked: history stays in memory only */
  }
}

export function useChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<Turn[]>([]);

  useEffect(() => {
    const restored = load();
    turnsRef.current = restored;
    setTurns(restored);
    setHydrated(true);
  }, []);

  const update = useCallback((fn: (prev: Turn[]) => Turn[]) => {
    setTurns((prev) => {
      const next = fn(prev);
      turnsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const streaming = turns.some((t) => t.role === "assistant" && t.status === "streaming");
    if (!streaming) save(turns);
  }, [turns, hydrated]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = turns.some((t) => t.role === "assistant" && t.status === "streaming");

  const run = useCallback(
    async (history: Turn[]) => {
      const assistantId = uid();
      const patch = (fn: (t: AssistantTurn) => AssistantTurn) =>
        update((prev) => prev.map((t) => (t.id === assistantId && t.role === "assistant" ? fn(t) : t)));
      update(() => [...history, { id: assistantId, role: "assistant", parts: [], status: "streaming" }]);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: toRequestMessages(history) }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const json = (await res.json().catch(() => ({}))) as { error?: string; code?: ChatErrorCode };
          patch((t) => ({ ...t, status: "error", error: { code: json.code ?? "model_error", message: json.error ?? `Request failed (${res.status}).` } }));
          return;
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const { events, rest } = decodeEvents(buffer + value);
          buffer = rest;
          if (events.length) patch((t) => events.reduce(applyEvent, t));
        }
        patch((t) => (t.status === "streaming" ? { ...t, status: "error", error: { code: "network", message: "The connection closed before the answer finished." } } : t));
      } catch (err) {
        const aborted = controller.signal.aborted;
        patch((t) =>
          t.status !== "streaming"
            ? t
            : aborted
              ? { ...t, status: "stopped", parts: t.parts.map((p) => (p.type === "tool" && p.status === "running" ? { ...p, status: "error", summary: "Stopped" } : p)) }
              : { ...t, status: "error", error: { code: "network", message: err instanceof Error ? err.message : "Network error" } },
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [update],
  );

  const send = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, CHAT_LIMITS.maxUserChars);
      if (!clean || turnsRef.current.some((t) => t.role === "assistant" && t.status === "streaming")) return;
      void run([...turnsRef.current, { id: uid(), role: "user", text: clean }]);
    },
    [run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Re-asks the last user message, replacing the assistant answer after it. */
  const retry = useCallback(() => {
    const list = turnsRef.current;
    const lastUser = list.map((t) => t.role).lastIndexOf("user");
    if (lastUser < 0 || list.some((t) => t.role === "assistant" && t.status === "streaming")) return;
    void run(list.slice(0, lastUser + 1));
  }, [run]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    update(() => []);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [update]);

  return { turns, hydrated, busy, send, stop, retry, reset };
}
