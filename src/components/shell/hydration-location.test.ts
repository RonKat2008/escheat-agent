import { describe, expect, it } from "vitest";
import { pickShellLocation } from "./hydration-location";

const reports = { pathname: "/reports", search: "?state=DE" };
const chat = { pathname: "/chat", search: "" };

describe("pickShellLocation", () => {
  it("renders the document's own location while hydrating, even if the router already moved on", () => {
    // The ui-close-out case: HTML for /reports, a click on "Plan close-out" navigated to /chat before the sidebar hydrated.
    expect(pickShellLocation(true, reports, chat)).toEqual(reports);
  });

  it("renders the live location after hydration", () => {
    expect(pickShellLocation(false, reports, chat)).toEqual(chat);
  });

  it("uses the live location on the server (no document location)", () => {
    expect(pickShellLocation(true, null, chat)).toEqual(chat);
    expect(pickShellLocation(false, null, chat)).toEqual(chat);
  });
});
