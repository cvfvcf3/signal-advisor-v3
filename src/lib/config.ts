export const SYMBOLS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XRP/USDT",
  "ADA/USDT",
  "DOGE/USDT",
] as const;

export type Symbol = (typeof SYMBOLS)[number];

export const MODES = ["scalp", "day", "swing"] as const;
export type Mode = (typeof MODES)[number];

export const LAYER_NAMES = [
  "technical",
  "multi_timeframe",
  "orderbook",
  "market_structure",
  "smc",
] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export type ModeConfig = {
  /** Base timeframe used for entry analysis. */
  bar: string;
  /** Higher timeframe(s) used for trend confirmation. */
  htf: string[];
  /** Candles the signal gets to work before it expires. */
  evaluateAfterCandles: number;
  /** Target move (fraction of entry price) used for TP. */
  successMovePct: number;
  /** Risk/reward: SL distance = successMovePct / rr. */
  rr: number;
  /** Minimum confidence required to publish a signal. */
  minConfidence: number;
  /** Minutes before the same symbol/mode may fire again. */
  cooldownMinutes: number;
  /** Layer weights (should sum to ~1; not enforced so admin tuning can't 500). */
  weights: Record<LayerName, number>;
  label: string;
};

// Mutable on purpose: /api/admin/reload-config patches fields on these
// objects in place at runtime (see ALLOWED_MODE_FIELDS there for exactly
// which fields it will touch). Everything else in this file is constant.
export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  scalp: {
    bar: "5m",
    htf: ["1H"],
    evaluateAfterCandles: 12,
    successMovePct: 0.006,
    rr: 1.25,
    minConfidence: 62,
    cooldownMinutes: 20,
    weights: {
      technical: 0.3,
      multi_timeframe: 0.15,
      orderbook: 0.3,
      market_structure: 0.1,
      smc: 0.15,
    },
    label: "5m entries · quick flips",
  },
  day: {
    bar: "1H",
    htf: ["4H"],
    evaluateAfterCandles: 24,
    successMovePct: 0.015,
    rr: 1.5,
    minConfidence: 64,
    cooldownMinutes: 90,
    weights: {
      technical: 0.32,
      multi_timeframe: 0.22,
      orderbook: 0.14,
      market_structure: 0.14,
      smc: 0.18,
    },
    label: "1H entries · intraday",
  },
  swing: {
    bar: "4H",
    // Spec calls for 4h main / 1d higher / 1w additional confirmation.
    // Both entries feed multiTimeframeLayer, so a bullish 1D but bearish 1W
    // now visibly pulls the MTF score down instead of being silently ignored.
    htf: ["1D", "1W"],
    evaluateAfterCandles: 30,
    successMovePct: 0.03,
    rr: 1.6,
    minConfidence: 66,
    cooldownMinutes: 360,
    weights: {
      technical: 0.28,
      multi_timeframe: 0.3,
      orderbook: 0.08,
      market_structure: 0.14,
      smc: 0.2,
    },
    label: "4H entries · multi-day",
  },
};

export const TELEGRAM_CONFIG = {
  get enabled() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  },
  minConfidenceToNotify: Number(process.env.TELEGRAM_MIN_CONFIDENCE ?? 70),
};

export function isMode(value: string | null | undefined): value is Mode {
  return !!value && (MODES as readonly string[]).includes(value);
}

export function isSymbol(value: string | null | undefined): value is Symbol {
  return !!value && (SYMBOLS as readonly string[]).includes(value);
}

/** "BTC/USDT" -> "BTC-USDT" (OKX spot instrument id). */
export function toInstId(symbol: string): string {
  return symbol.replace("/", "-");
}

/** "BTC/USDT" -> "BTC-USDT-SWAP" (OKX perp instrument id, for funding/OI). */
export function toSwapInstId(symbol: string): string {
  return `${toInstId(symbol)}-SWAP`;
}
