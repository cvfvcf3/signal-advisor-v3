import { describe, expect, it } from "vitest";
import { computeBackoffDelayMs, formatMessage } from "../telegramNotifier";

describe("computeBackoffDelayMs", () => {
  it("starts at 5s after the first failed attempt", () => {
    expect(computeBackoffDelayMs(1)).toBe(10_000); // 5000 * 2^1
  });

  it("doubles with each successive attempt", () => {
    const delays = [1, 2, 3, 4, 5].map(computeBackoffDelayMs);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBe(delays[i - 1] * 2);
    }
  });

  it("caps at 1 hour and never exceeds it, however many attempts", () => {
    const ONE_HOUR = 60 * 60_000;
    expect(computeBackoffDelayMs(9)).toBe(ONE_HOUR);
    expect(computeBackoffDelayMs(50)).toBe(ONE_HOUR);
    expect(computeBackoffDelayMs(10_000)).toBe(ONE_HOUR);
  });

  it("is monotonically non-decreasing", () => {
    let prev = 0;
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = computeBackoffDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(prev);
      prev = delay;
    }
  });
});

describe("formatMessage", () => {
  const baseSignal = {
    signalId: "abc-123",
    symbol: "BTC/USDT",
    mode: "scalp",
    action: "BUY" as const,
    confidence: 82,
    entryPrice: 65000.12,
    takeProfit: 65500,
    stopLoss: 64700,
    layers: {
      technical: { bullish_score: 80, bearish_score: 10, details: {} },
      multi_timeframe: { bullish_score: 75, bearish_score: 20, details: {} },
      orderbook: { bullish_score: 60, bearish_score: 15, details: {} },
      market_structure: { bullish_score: 70, bearish_score: 5, details: {} },
      smc: { bullish_score: 65, bearish_score: 10, details: {} },
    },
  };

  it("includes the symbol, mode, direction, confidence, entry, TP and SL", () => {
    const text = formatMessage(baseSignal);
    expect(text).toContain("BTC/USDT");
    expect(text).toContain("scalp");
    expect(text).toContain("BUY");
    expect(text).toContain("82");
    expect(text).toContain("65000.12");
    expect(text).toContain("65500");
    expect(text).toContain("64700");
  });

  it("always carries the read-only / no-trade disclaimer (spec: never claim guaranteed profit or imply execution)", () => {
    const text = formatMessage(baseSignal);
    expect(text.toLowerCase()).toContain("read-only");
    expect(text.toLowerCase()).toContain("no trade was placed");
  });

  it("lists all five scoring layers", () => {
    const text = formatMessage(baseSignal);
    for (const layer of ["technical", "multi_timeframe", "orderbook", "market_structure", "smc"]) {
      expect(text).toContain(layer);
    }
  });

  it("degrades gracefully when TP/SL are missing rather than throwing", () => {
    const text = formatMessage({ ...baseSignal, takeProfit: null, stopLoss: null });
    expect(text).toContain("--");
  });
});
