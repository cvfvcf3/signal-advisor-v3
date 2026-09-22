import { describe, expect, it } from "vitest";
import { validatePayload } from "../adminValidation";

describe("validatePayload", () => {
  it("accepts an empty payload (no-op reload)", () => {
    expect(validatePayload({})).toEqual({ valid: true });
  });

  it("rejects a non-object payload", () => {
    expect(validatePayload(null).valid).toBe(false);
    expect(validatePayload("nope").valid).toBe(false);
    expect(validatePayload([1, 2, 3]).valid).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    const result = validatePayload({ modes: {}, apiKey: "leak-attempt" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/apiKey/);
  });

  it("rejects an unknown mode name", () => {
    const result = validatePayload({ modes: { yolo: { minConfidence: 50 } } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unknown mode/);
  });

  it("rejects fields outside the allow-list for a mode", () => {
    const result = validatePayload({ modes: { scalp: { bar: "1m" } } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/fields not allowed/);
  });

  it("accepts valid weights that sum close to 1.0", () => {
    const result = validatePayload({
      modes: {
        scalp: {
          weights: { technical: 0.3, multi_timeframe: 0.2, orderbook: 0.2, market_structure: 0.15, smc: 0.15 },
        },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a negative weight", () => {
    const result = validatePayload({ modes: { scalp: { weights: { technical: -0.1 } } } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/non-negative/);
  });

  it("rejects a weight for an unknown scoring layer", () => {
    const result = validatePayload({ modes: { scalp: { weights: { vibes: 0.5 } } } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not a known scoring layer/);
  });

  it("rejects a weight set whose total is absurdly malformed (e.g. way over 1.0)", () => {
    const result = validatePayload({
      modes: { scalp: { weights: { technical: 5, multi_timeframe: 5, orderbook: 5, market_structure: 5, smc: 5 } } },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must sum to roughly 1.0/);
  });

  it("rejects minConfidence outside 0-100", () => {
    expect(validatePayload({ modes: { scalp: { minConfidence: 150 } } }).valid).toBe(false);
    expect(validatePayload({ modes: { scalp: { minConfidence: -5 } } }).valid).toBe(false);
    expect(validatePayload({ modes: { scalp: { minConfidence: "high" } } }).valid).toBe(false);
  });

  it("accepts a valid minConfidence", () => {
    expect(validatePayload({ modes: { scalp: { minConfidence: 70 } } }).valid).toBe(true);
  });

  it("rejects a negative cooldownMinutes", () => {
    const result = validatePayload({ modes: { day: { cooldownMinutes: -10 } } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/>= 0/);
  });

  it("accepts a valid cooldownMinutes, including 0", () => {
    expect(validatePayload({ modes: { day: { cooldownMinutes: 0 } } }).valid).toBe(true);
    expect(validatePayload({ modes: { day: { cooldownMinutes: 45 } } }).valid).toBe(true);
  });
});
