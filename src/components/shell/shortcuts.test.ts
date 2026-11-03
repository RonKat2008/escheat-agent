import { describe, expect, it } from "vitest";
import { ariaKeys, createMatcher, eventToken, GO_TARGETS, isTypingTarget, keyChips, SHORTCUTS } from "./shortcuts";

describe("shortcut registry", () => {
  it("has unique ids and no two shell shortcuts share a key sequence", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const shell = SHORTCUTS.filter((s) => s.handledBy === "shell").map((s) => s.keys.join(" "));
    expect(new Set(shell).size).toBe(shell.length);
  });

  it("covers every g target from the spec (d i p a f c r e s)", () => {
    expect(GO_TARGETS.map((t) => t.key).join("")).toBe("dipafcres");
    for (const t of GO_TARGETS) expect(SHORTCUTS.find((s) => s.id === `go-${t.key}`)?.href).toBe(t.href);
  });

  it("documents the page-owned keys too, so the ? sheet is complete", () => {
    for (const id of ["list-down", "list-up", "list-toggle", "items-draft", "approve", "approve-next", "reject", "edit"]) {
      expect(SHORTCUTS.find((s) => s.id === id)?.handledBy).toBe("page");
    }
  });
});

describe("eventToken", () => {
  it("normalises modifiers and symbols", () => {
    expect(eventToken({ key: "k", metaKey: true })).toBe("mod+k");
    expect(eventToken({ key: "K", ctrlKey: true })).toBe("mod+k");
    expect(eventToken({ key: "?", shiftKey: true })).toBe("?");
    expect(eventToken({ key: "." })).toBe(".");
    expect(eventToken({ key: "ArrowDown", shiftKey: true })).toBe("shift+arrowdown");
  });
});

describe("createMatcher", () => {
  it("matches single keys and modifier combos", () => {
    const feed = createMatcher();
    expect((feed(".", 0) as { id: string }).id).toBe("next-action");
    expect((feed("mod+k", 10) as { id: string }).id).toBe("palette");
    expect((feed("?", 20) as { id: string }).id).toBe("shortcuts");
  });

  it("matches g chords and reports pending in between", () => {
    const feed = createMatcher();
    expect(feed("g", 0)).toBe("pending");
    const hit = feed("a", 100);
    expect(hit).toMatchObject({ id: "go-a", href: "/approvals" });
  });

  it("drops a chord after the timeout", () => {
    const feed = createMatcher(undefined, 500);
    expect(feed("g", 0)).toBe("pending");
    expect(feed("d", 2000)).toBeNull();
  });

  it("restarts on a broken chord so the second key can still act", () => {
    const feed = createMatcher();
    expect(feed("g", 0)).toBe("pending");
    expect(feed("z", 10)).toBeNull();
    expect(feed("g", 20)).toBe("pending");
    expect(feed(".", 30)).toMatchObject({ id: "next-action" });
  });

  it("ignores keys the shell does not own", () => {
    const feed = createMatcher();
    expect(feed("j", 0)).toBeNull();
    expect(feed("x", 10)).toBeNull();
  });
});

describe("helpers", () => {
  it("never steals keys from fields", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: () => "combobox" })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", getAttribute: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("renders chips and aria-keyshortcuts", () => {
    expect(keyChips(["mod+k"])).toEqual(["⌘K"]);
    expect(keyChips(["mod+k"], false)).toEqual(["Ctrl K"]);
    expect(keyChips(["g", "d"])).toEqual(["G", "D"]);
    expect(ariaKeys(["mod+k"])).toBe("Meta+K Control+K");
    expect(ariaKeys(["g", "d"])).toBe("G D");
    expect(ariaKeys(["."])).toBe(".");
  });
});
