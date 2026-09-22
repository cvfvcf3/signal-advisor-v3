import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "../auth";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("supersecret", "supersecret")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(constantTimeEqual("supersecret", "supersecreX")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(() => constantTimeEqual("short", "a-much-longer-secret")).not.toThrow();
    expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns false when either side is empty", () => {
    expect(constantTimeEqual("", "secret")).toBe(false);
    expect(constantTimeEqual("secret", "")).toBe(false);
  });
});
