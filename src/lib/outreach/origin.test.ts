import { describe, expect, it } from "vitest";
import { baseUrlFrom } from "./origin";

describe("baseUrlFrom", () => {
  it("prefers APP_BASE_URL and trims trailing slashes", () => {
    expect(baseUrlFrom({ appBaseUrl: "https://app.example.test//", requestOrigin: "http://localhost:3112" })).toBe("https://app.example.test");
  });
  it("uses the request origin when APP_BASE_URL is unset", () => {
    expect(baseUrlFrom({ requestOrigin: "http://localhost:3112" })).toBe("http://localhost:3112");
  });
  it("falls back to PORT, then 3000, only when there is no request", () => {
    expect(baseUrlFrom({ port: "3112" })).toBe("http://localhost:3112");
    expect(baseUrlFrom({})).toBe("http://localhost:3000");
  });
  it("ignores a blank APP_BASE_URL", () => {
    expect(baseUrlFrom({ appBaseUrl: "  ", requestOrigin: "http://localhost:4000" })).toBe("http://localhost:4000");
  });
});
