import { describe, expect, it } from "vitest";
import { clamp, priceRound, rsi, round, zScore } from "../indicators";

describe("round / priceRound", () => {
  it("rounds to the given number of digits", () => {
    expect(round(1.23456, 2)).toBe(1.23);
  });

  it("scales price precision with magnitude (BTC vs DOGE)", () => {
    expect(priceRound(65432.1234)).toBe(65432.12); // >= 1000 -> 2dp
    expect(priceRound(0.07321)).toBe(0.073210); // < 1 -> 6dp
  });
});

describe("clamp", () => {
  it("keeps values within [0, 100] by default", () => {
    expect(clamp(150)).toBe(100);
    expect(clamp(-10)).toBe(0);
    expect(clamp(42)).toBe(42);
  });
});

describe("rsi", () => {
  it("returns 50 (neutral) when there isn't enough data", () => {
    expect(rsi([1, 2, 3])).toBe(50);
  });

  it("returns 100 when every move in the window is a gain", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(values)).toBe(100);
  });
});

describe("zScore", () => {
  it("returns 0 when the sample has no variance", () => {
    expect(zScore([5, 5, 5, 5], 5)).toBe(0);
  });

  it("returns a positive score for a value above the mean", () => {
    expect(zScore([1, 2, 3, 4, 5], 5)).toBeGreaterThan(0);
  });
});
