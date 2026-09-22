import {
  atr,
  clamp,
  ema,
  macd,
  priceRound,
  round,
  rsi,
  sma,
  swings,
  zScore,
  type Candle,
} from "./indicators";
import type { LayerName, Mode, ModeConfig } from "./config";
import type { FundingInfo, OpenInterestInfo, OrderBook } from "./okx";

export type LayerResult = {
  bullish_score: number;
  bearish_score: number;
  details: Record<string, string | number | boolean | null>;
};

export type Layers = Record<LayerName, LayerResult>;

export type MarketData = {
  symbol: string;
  candles: Record<string, Candle[]>; // keyed by bar
  book: OrderBook | null;
  funding: FundingInfo | null;
  oi: OpenInterestInfo | null;
};

export type Reading = {
  symbol: string;
  mode: Mode;
  action: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entryPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  bullishScore: number;
  bearishScore: number;
  layers: Layers;
  atrPct: number;
};

function technicalLayer(candles: Candle[]): LayerResult {
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  let bull = 0;
  let bear = 0;
  const details: LayerResult["details"] = {};

  const e9 = ema(closes, 9).at(-1) ?? 0;
  const e21 = ema(closes, 21).at(-1) ?? 0;
  const e50 = ema(closes, 50).at(-1) ?? 0;
  if (e9 > e21 && e21 > e50) {
    bull += 26;
    details.ema_cross = "bull_trend";
  } else if (e9 < e21 && e21 < e50) {
    bear += 26;
    details.ema_cross = "bear_trend";
  } else if (e9 > e21) {
    bull += 12;
    details.ema_cross = "early_bull";
  } else {
    bear += 12;
    details.ema_cross = "early_bear";
  }

  const m = macd(closes);
  if (m.hist > 0) {
    bull += m.hist > Math.abs(m.macd) * 0.15 ? 22 : 12;
    details.macd = "bull_momentum";
  } else {
    bear += Math.abs(m.hist) > Math.abs(m.macd) * 0.15 ? 22 : 12;
    details.macd = "bear_momentum";
  }
  details.macd_hist = round(m.hist, 4);

  const r = rsi(closes);
  details.rsi = round(r, 1);
  if (r >= 70) {
    bear += 14;
    details.rsi_state = `overbought(${round(r, 1)})`;
  } else if (r <= 30) {
    bull += 14;
    details.rsi_state = `oversold(${round(r, 1)})`;
  } else if (r > 55) {
    bull += 16;
    details.rsi_state = `mild_bull(${round(r, 1)})`;
  } else if (r < 45) {
    bear += 16;
    details.rsi_state = `mild_bear(${round(r, 1)})`;
  } else {
    details.rsi_state = `neutral(${round(r, 1)})`;
  }

  const avgVol = sma(
    candles.slice(0, -1).map((c) => c.volume),
    20,
  );
  const volMult = avgVol > 0 ? last.volume / avgVol : 1;
  details.volume = `${round(volMult, 2)}x`;
  if (volMult > 1.4) {
    if (last.close >= last.open) bull += 18;
    else bear += 18;
  } else if (volMult < 0.6) {
    details.volume_note = "thin";
  }

  const window = candles.slice(-40);
  const hi = Math.max(...window.map((c) => c.high));
  const lo = Math.min(...window.map((c) => c.low));
  const pos = hi === lo ? 0.5 : (last.close - lo) / (hi - lo);
  details.range_position = round(pos, 2);
  if (pos > 0.82) {
    bull += 12;
    details.structure = "breakout_zone";
  } else if (pos < 0.18) {
    bear += 12;
    details.structure = "breakdown_zone";
  } else {
    details.structure = "mid_range";
  }

  return {
    bullish_score: clamp(round(bull, 2)),
    bearish_score: clamp(round(bear, 2)),
    details,
  };
}

function multiTimeframeLayer(
  htfBars: string[],
  candlesByBar: Record<string, Candle[]>,
): LayerResult {
  const details: LayerResult["details"] = {};
  let bullish = 0;
  let total = 0;
  for (const bar of htfBars) {
    const candles = candlesByBar[bar];
    if (!candles || candles.length < 60) continue;
    total += 1;
    const closes = candles.map((c) => c.close);
    const e20 = ema(closes, 20).at(-1) ?? 0;
    const e50 = ema(closes, 50).at(-1) ?? 0;
    const price = closes[closes.length - 1];
    const isBull = e20 > e50 && price > e50;
    if (isBull) bullish += 1;
    details[bar] = isBull ? "bullish" : "bearish";
  }
  if (total === 0) {
    return { bullish_score: 0, bearish_score: 0, details: { note: "no_data" } };
  }
  const pct = (bullish / total) * 100;
  return {
    bullish_score: round(pct, 2),
    bearish_score: round(100 - pct, 2),
    details,
  };
}

function orderbookLayer(book: OrderBook | null, price: number): LayerResult {
  if (!book || book.bids.length === 0 || book.asks.length === 0) {
    return { bullish_score: 0, bearish_score: 0, details: { note: "no_book" } };
  }
  const depth = 25;
  const bidVol = book.bids.slice(0, depth).reduce((a, b) => a + b[1], 0);
  const askVol = book.asks.slice(0, depth).reduce((a, b) => a + b[1], 0);
  const totalVol = bidVol + askVol;
  const imbalance = totalVol > 0 ? bidVol / totalVol : 0.5;
  const spreadPct =
    price > 0 ? ((book.asks[0][0] - book.bids[0][0]) / price) * 100 : 0;

  const avgBid = bidVol / depth;
  const avgAsk = askVol / depth;
  const bidWall = book.bids.slice(0, depth).some((b) => b[1] > avgBid * 4);
  const askWall = book.asks.slice(0, depth).some((b) => b[1] > avgAsk * 4);

  let bull = 0;
  let bear = 0;
  const edge = (imbalance - 0.5) * 200; // -100..100
  if (edge > 0) bull += clamp(edge * 1.1);
  else bear += clamp(-edge * 1.1);
  if (bidWall && !askWall) bull += 12;
  if (askWall && !bidWall) bear += 12;

  return {
    bullish_score: clamp(round(bull, 2)),
    bearish_score: clamp(round(bear, 2)),
    details: {
      imbalance: round(imbalance, 3),
      spread_pct: round(spreadPct, 4),
      bid_wall: bidWall,
      ask_wall: askWall,
      bid_depth: round(bidVol, 2),
      ask_depth: round(askVol, 2),
    },
  };
}

function marketStructureLayer(
  funding: FundingInfo | null,
  oi: OpenInterestInfo | null,
  candles: Candle[],
): LayerResult {
  const details: LayerResult["details"] = {};
  let bull = 0;
  let bear = 0;

  const closes = candles.map((c) => c.close);
  const priceChangePct =
    closes.length > 12
      ? ((closes[closes.length - 1] - closes[closes.length - 12]) /
          closes[closes.length - 12]) *
        100
      : 0;
  details.price_change_pct = round(priceChangePct, 3);

  if (funding && funding.history.length > 5) {
    const fz = zScore(funding.history, funding.current);
    details.funding_rate = round(funding.current, 6);
    details.funding_z = round(fz, 3);
    // Crowded longs (very positive funding) = squeeze risk -> bearish tilt.
    if (fz > 1.5) bear += 26;
    else if (fz < -1.5) bull += 26;
    else if (fz > 0.6) bear += 10;
    else if (fz < -0.6) bull += 10;
  } else {
    details.funding_rate = null;
  }

  if (oi && oi.history.length > 5) {
    const oz = zScore(oi.history, oi.current);
    details.open_interest = round(oi.current, 2);
    details.oi_z = round(oz, 3);
    if (oz > 0.5 && priceChangePct > 0) bull += 30;
    else if (oz > 0.5 && priceChangePct < 0) bear += 30;
    else if (oz < -0.5 && priceChangePct < 0) bull += 14; // shorts covering
    else if (oz < -0.5 && priceChangePct > 0) bear += 14;
  } else {
    details.open_interest = null;
  }

  if (priceChangePct > 0.4) bull += 12;
  else if (priceChangePct < -0.4) bear += 12;

  return {
    bullish_score: clamp(round(bull, 2)),
    bearish_score: clamp(round(bear, 2)),
    details,
  };
}

function smcLayer(candles: Candle[]): LayerResult {
  const details: LayerResult["details"] = {};
  let bull = 0;
  let bear = 0;
  const { highs, lows } = swings(candles, 2);
  const last = candles[candles.length - 1];

  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);

  if (lastHighs.length === 2 && lastLows.length === 2) {
    const hh = lastHighs[1].price > lastHighs[0].price;
    const hl = lastLows[1].price > lastLows[0].price;
    if (hh && hl) {
      bull += 26;
      details.structure_bias = "bullish";
    } else if (!hh && !hl) {
      bear += 26;
      details.structure_bias = "bearish";
    } else {
      details.structure_bias = "ranging";
    }
  } else {
    details.structure_bias = "unknown";
  }

  // Break of structure on the latest close.
  const prevHigh = highs.at(-1)?.price;
  const prevLow = lows.at(-1)?.price;
  if (prevHigh && last.close > prevHigh) {
    bull += 20;
    details.structure_event = "bullish_bos";
  } else if (prevLow && last.close < prevLow) {
    bear += 20;
    details.structure_event = "bearish_bos";
  } else {
    details.structure_event = "none";
  }

  // Liquidity sweep: wick takes out a prior swing but body closes back inside.
  if (prevLow && last.low < prevLow && last.close > prevLow) {
    bull += 22;
    details.liquidity_sweep = `bullish_sweep@${priceRound(prevLow)}`;
  } else if (prevHigh && last.high > prevHigh && last.close < prevHigh) {
    bear += 22;
    details.liquidity_sweep = `bearish_sweep@${priceRound(prevHigh)}`;
  } else {
    details.liquidity_sweep = "none";
  }

  // Fair value gap in the last three candles.
  const n = candles.length;
  if (n >= 3) {
    const a = candles[n - 3];
    const c = candles[n - 1];
    if (c.low > a.high) {
      bull += 14;
      details.fvg = `bullish ${priceRound(a.high)}-${priceRound(c.low)}`;
    } else if (c.high < a.low) {
      bear += 14;
      details.fvg = `bearish ${priceRound(c.high)}-${priceRound(a.low)}`;
    } else {
      details.fvg = "none";
    }
  }

  return {
    bullish_score: clamp(round(bull, 2)),
    bearish_score: clamp(round(bear, 2)),
    details,
  };
}

export function buildReading(
  data: MarketData,
  mode: Mode,
  cfg: ModeConfig,
): Reading | null {
  const base = data.candles[cfg.bar];
  if (!base || base.length < 60) return null;
  const price = base[base.length - 1].close;

  const layers: Layers = {
    technical: technicalLayer(base),
    multi_timeframe: multiTimeframeLayer(cfg.htf, data.candles),
    orderbook: orderbookLayer(data.book, price),
    market_structure: marketStructureLayer(data.funding, data.oi, base),
    smc: smcLayer(base),
  };

  let bullTotal = 0;
  let bearTotal = 0;
  (Object.keys(layers) as LayerName[]).forEach((name) => {
    bullTotal += layers[name].bullish_score * cfg.weights[name];
    bearTotal += layers[name].bearish_score * cfg.weights[name];
  });
  bullTotal = round(bullTotal, 2);
  bearTotal = round(bearTotal, 2);

  const net = bullTotal - bearTotal;
  const confidence = round(clamp(50 + net / 2, 0, 99), 2);

  const atrValue = atr(base.slice(-60), 14);
  const atrPct = price > 0 ? atrValue / price : 0;
  const targetPct = Math.max(cfg.successMovePct, atrPct * 1.4);
  const stopPct = targetPct / cfg.rr;

  let action: Reading["action"] = "WAIT";
  if (confidence >= cfg.minConfidence && net > 0) action = "BUY";
  else if (100 - confidence >= cfg.minConfidence && net < 0) action = "SELL";

  let takeProfit: number | null = null;
  let stopLoss: number | null = null;
  if (action === "BUY") {
    takeProfit = priceRound(price * (1 + targetPct));
    stopLoss = priceRound(price * (1 - stopPct));
  } else if (action === "SELL") {
    takeProfit = priceRound(price * (1 - targetPct));
    stopLoss = priceRound(price * (1 + stopPct));
  }

  return {
    symbol: data.symbol,
    mode,
    action,
    confidence: action === "SELL" ? round(100 - confidence, 2) : confidence,
    entryPrice: priceRound(price),
    takeProfit,
    stopLoss,
    bullishScore: bullTotal,
    bearishScore: bearTotal,
    layers,
    atrPct: round(atrPct * 100, 3),
  };
}

export const SUCCESS_MOVE = (cfg: ModeConfig) => cfg.successMovePct;
