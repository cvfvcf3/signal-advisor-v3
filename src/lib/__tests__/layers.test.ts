import { describe, expect, it } from "vitest";
import { buildReading } from "../layers";
import { MODE_CONFIG } from "../config";
import type { Candle } from "../indicators";

/**
 * Deterministic synthetic candle series. `drift` is the per-candle percentage
 * move (positive = uptrend, negative = downtrend, 0 = flat/choppy). A small
 * alternating wiggle is added even in trending series so EMA/RSI/SMC see
 * realistic higher-highs/higher-lows structure rather than a straight line.
 */
function makeCandles(n: number, opts: { start?: number; drift?: number; barMs?: number; volume?: number } = {}): Candle[] {
  const { start = 100, drift = 0, barMs = 5 * 60_000, volume = 1000 } = opts;
  const candles: Candle[] = [];
  let price = start;
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const wiggle = Math.sin(i / 3) * Math.abs(drift) * 0.4;
    const open = price;
    price = price * (1 + drift + wiggle * 0.01);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.abs(drift) * 0.3 + 0.0005);
    const low = Math.min(open, close) * (1 - Math.abs(drift) * 0.3 - 0.0005);
    candles.push({
      time: now - (n - i) * barMs,
      open,
      high,
      low,
      close,
      volume: volume * (1 + (i % 5 === 0 ? 0.6 : 0)), // occasional volume expansion
    });
  }
  return candles;
}

describe("buildReading", () => {
  it("returns null when there is not enough closed-candle history", () => {
    const data = {
      symbol: "BTC/USDT",
      candles: { "5m": makeCandles(10), "1H": makeCandles(80) },
      book: null,
      funding: null,
      oi: null,
    };
    expect(buildReading(data, "scalp", MODE_CONFIG.scalp)).toBeNull();
  });

  it("produces BUY when the base timeframe and every HTF are strongly aligned bullish", () => {
    const data = {
      symbol: "BTC/USDT",
      candles: {
        "5m": makeCandles(120, { drift: 0.009 }),
        "1H": makeCandles(80, { drift: 0.009, barMs: 60 * 60_000 }),
      },
      book: null,
      funding: null,
      oi: null,
    };
    const reading = buildReading(data, "scalp", MODE_CONFIG.scalp);
    expect(reading).not.toBeNull();
    expect(reading!.action).toBe("BUY");
    expect(reading!.confidence).toBeGreaterThanOrEqual(MODE_CONFIG.scalp.minConfidence);
    // BUY signals must carry actionable TP/SL above/below entry respectively.
    expect(reading!.takeProfit).toBeGreaterThan(reading!.entryPrice);
    expect(reading!.stopLoss).toBeLessThan(reading!.entryPrice);
  });

  it("produces SELL when the base timeframe and every HTF are strongly aligned bearish", () => {
    const data = {
      symbol: "BTC/USDT",
      candles: {
        "5m": makeCandles(120, { drift: -0.009 }),
        "1H": makeCandles(80, { drift: -0.009, barMs: 60 * 60_000 }),
      },
      book: null,
      funding: null,
      oi: null,
    };
    const reading = buildReading(data, "scalp", MODE_CONFIG.scalp);
    expect(reading).not.toBeNull();
    expect(reading!.action).toBe("SELL");
    expect(reading!.takeProfit).toBeLessThan(reading!.entryPrice);
    expect(reading!.stopLoss).toBeGreaterThan(reading!.entryPrice);
  });

  function makeChoppyCandles(n: number, opts: { barMs?: number } = {}): Candle[] {
    // Alternating up/down legs with no net drift — a real no-edge market,
    // as opposed to a perfectly flat series (every OHLC identical), which is
    // a degenerate input: EMA9 === EMA21 === EMA50 exactly, and technicalLayer's
    // tie-break for that exact-equality case falls through to its bearish
    // branch (see technicalLayer in layers.ts: `e9 > e21` is false when they're
    // equal, so it lands in `else { bear += 12 }`). That's a real, worth-noting
    // quirk in a perfectly flat input, but not what "choppy" should mean here.
    const { barMs = 5 * 60_000 } = opts;
    const legLength = 6;
    const candles: Candle[] = [];
    let price = 100;
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const leg = Math.floor(i / legLength) % 2 === 0 ? 1 : -1;
      const open = price;
      price = price * (1 + leg * 0.003);
      const close = price;
      const high = Math.max(open, close) * 1.001;
      const low = Math.min(open, close) * 0.999;
      candles.push({ time: now - (n - i) * barMs, open, high, low, close, volume: 1000 });
    }
    return candles;
  }

  it("returns WAIT on choppy data with no clear directional edge", () => {
    const data = {
      symbol: "BTC/USDT",
      candles: {
        "5m": makeChoppyCandles(120),
        "1H": makeChoppyCandles(80, { barMs: 60 * 60_000 }),
      },
      book: null,
      funding: null,
      oi: null,
    };
    const reading = buildReading(data, "scalp", MODE_CONFIG.scalp);
    expect(reading).not.toBeNull();
    expect(reading!.action).toBe("WAIT");
  });

  it("does not produce a BUY when a mild base-timeframe uptrend conflicts with a strongly bearish HTF", () => {
    // A weak 5m uptrend alone would not be enough to independently justify
    // a signal either way; what this test isolates is that a strongly
    // bearish 1H does not get overridden or ignored by that weak 5m signal.
    // Per the spec ("reduce confidence instead of blindly generating BUY"),
    // multiTimeframeLayer must be pulling the net score down, not up.
    const conflicting = buildReading(
      {
        symbol: "BTC/USDT",
        candles: {
          "5m": makeCandles(120, { drift: 0.0004 }),
          "1H": makeCandles(80, { drift: -0.008, barMs: 60 * 60_000 }),
        },
        book: null,
        funding: null,
        oi: null,
      },
      "scalp",
      MODE_CONFIG.scalp,
    );
    expect(conflicting).not.toBeNull();
    expect(conflicting!.action).not.toBe("BUY");

    // Same 5m data, but with the HTF now agreeing (bullish) instead of
    // fighting it, should never leave the reading less bullish than the
    // conflicting version — proving multiTimeframeLayer's disagreement was
    // actually penalized, not a no-op.
    const aligned = buildReading(
      {
        symbol: "BTC/USDT",
        candles: {
          "5m": makeCandles(120, { drift: 0.0004 }),
          "1H": makeCandles(80, { drift: 0.0004, barMs: 60 * 60_000 }),
        },
        book: null,
        funding: null,
        oi: null,
      },
      "scalp",
      MODE_CONFIG.scalp,
    );
    expect(aligned).not.toBeNull();
    const netScoreOf = (r: NonNullable<ReturnType<typeof buildReading>>) => r.bullishScore - r.bearishScore;
    expect(netScoreOf(aligned!)).toBeGreaterThan(netScoreOf(conflicting!));
  });

  it("includes all five scoring layers in every reading", () => {
    const data = {
      symbol: "BTC/USDT",
      candles: {
        "5m": makeCandles(120, { drift: 0.006 }),
        "1H": makeCandles(80, { drift: 0.006, barMs: 60 * 60_000 }),
      },
      book: null,
      funding: null,
      oi: null,
    };
    const reading = buildReading(data, "scalp", MODE_CONFIG.scalp);
    expect(Object.keys(reading!.layers).sort()).toEqual(
      ["market_structure", "multi_timeframe", "orderbook", "smc", "technical"].sort(),
    );
  });

  it("swing mode reads a weekly (1W) confirmation timeframe alongside 4H/1D", () => {
    expect(MODE_CONFIG.swing.htf).toContain("1W");
    const data = {
      symbol: "BTC/USDT",
      candles: {
        "4H": makeCandles(120, { drift: 0.004, barMs: 4 * 60 * 60_000 }),
        "1D": makeCandles(80, { drift: 0.004, barMs: 24 * 60 * 60_000 }),
        "1W": makeCandles(70, { drift: 0.004, barMs: 7 * 24 * 60 * 60_000 }),
      },
      book: null,
      funding: null,
      oi: null,
    };
    const reading = buildReading(data, "swing", MODE_CONFIG.swing);
    expect(reading!.layers.multi_timeframe.details).toHaveProperty("1W");
  });
});
