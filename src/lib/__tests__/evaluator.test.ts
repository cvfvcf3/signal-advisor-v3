import { describe, expect, it } from "vitest";
import { evaluateSignal, type EvaluableSignal } from "../evaluator";
import type { Candle } from "../indicators";

function candle(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: 100 };
}

const buySignal: EvaluableSignal = {
  action: "BUY",
  entryPrice: 100,
  takeProfit: 110,
  stopLoss: 95,
  evaluateAfterCandles: 5,
};

describe("evaluateSignal (BUY)", () => {
  it("resolves CORRECT when only the take-profit is touched", () => {
    const window = [candle(1, 100, 105, 99, 104), candle(2, 104, 111, 103, 110)];
    const result = evaluateSignal(buySignal, window);
    expect(result?.status).toBe("CORRECT");
    expect(result?.exitPrice).toBe(110);
  });

  it("resolves INCORRECT when only the stop-loss is touched", () => {
    const window = [candle(1, 100, 102, 94, 95)];
    const result = evaluateSignal(buySignal, window);
    expect(result?.status).toBe("INCORRECT");
    expect(result?.exitPrice).toBe(95);
  });

  it("assumes stop-loss hit first when one candle touches both levels", () => {
    // Single wild candle: low sweeps below SL, high pokes above TP.
    const window = [candle(1, 100, 112, 90, 108)];
    const result = evaluateSignal(buySignal, window);
    expect(result?.status).toBe("INCORRECT");
    expect(result?.exitPrice).toBe(95);
  });

  it("resolves EXPIRED (not INCORRECT) when neither level is hit within the window", () => {
    const window = Array.from({ length: 5 }, (_, i) => candle(i, 100, 103, 98, 101));
    const result = evaluateSignal(buySignal, window);
    expect(result?.status).toBe("EXPIRED");
    expect(result?.exitPrice).toBe(101);
  });

  it("returns null (still pending) when fewer candles than the window have printed and neither level hit", () => {
    const window = [candle(1, 100, 103, 98, 101), candle(2, 101, 104, 99, 102)];
    const result = evaluateSignal(buySignal, window);
    expect(result).toBeNull();
  });

  it("picks whichever level is touched first across candles, not just the first candle's outcome", () => {
    // First candle touches neither; second candle hits TP.
    const window = [candle(1, 100, 103, 98, 101), candle(2, 101, 111, 100, 110)];
    const result = evaluateSignal(buySignal, window);
    expect(result?.status).toBe("CORRECT");
  });
});

describe("evaluateSignal (SELL)", () => {
  const sellSignal: EvaluableSignal = {
    action: "SELL",
    entryPrice: 100,
    takeProfit: 90,
    stopLoss: 105,
    evaluateAfterCandles: 5,
  };

  it("resolves CORRECT when price falls to the take-profit", () => {
    const window = [candle(1, 100, 101, 89, 90)];
    const result = evaluateSignal(sellSignal, window);
    expect(result?.status).toBe("CORRECT");
    expect(result?.exitPrice).toBe(90);
  });

  it("resolves INCORRECT when price rises to the stop-loss", () => {
    const window = [candle(1, 100, 106, 99, 105)];
    const result = evaluateSignal(sellSignal, window);
    expect(result?.status).toBe("INCORRECT");
    expect(result?.exitPrice).toBe(105);
  });

  it("assumes stop-loss hit first when one candle touches both levels", () => {
    const window = [candle(1, 100, 107, 88, 95)];
    const result = evaluateSignal(sellSignal, window);
    expect(result?.status).toBe("INCORRECT");
  });
});
