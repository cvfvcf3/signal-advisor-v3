export type Candle = {
  time: number; // ms epoch of candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number; signal: number; hist: number } {
  if (values.length < slow + signalPeriod) {
    return { macd: 0, signal: 0, hist: 0 };
  }
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(line, signalPeriod);
  const m = line[line.length - 1];
  const s = signalLine[signalLine.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close),
      ),
    );
  }
  return sma(trs, period);
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function zScore(values: number[], value: number): number {
  const sd = stdev(values);
  if (sd === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return (value - mean) / sd;
}

export type SwingPoint = { index: number; price: number };

/** Fractal swing highs / lows using a left/right lookback. */
export function swings(
  candles: Candle[],
  lookback = 2,
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: c.high });
    if (isLow) lows.push({ index: i, price: c.low });
  }
  return { highs, lows };
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Sensible price precision for both BTC (2dp) and DOGE (5dp). */
export function priceRound(value: number): number {
  if (value >= 1000) return round(value, 2);
  if (value >= 10) return round(value, 3);
  if (value >= 1) return round(value, 4);
  return round(value, 6);
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}
