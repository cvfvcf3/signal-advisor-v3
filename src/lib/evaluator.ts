/**
 * Evaluator: checks a PENDING signal against the closed candles that have
 * printed since it was created and resolves it to CORRECT / INCORRECT /
 * still-open (null).
 *
 * PATH-AWARE RESOLUTION: candles since entry are walked in chronological
 * order. Whichever level — take-profit or stop-loss — is touched FIRST
 * determines the outcome. If a single candle's high/low range touches BOTH
 * levels (common on a volatile 5m candle), the conservative assumption is
 * that stop-loss was hit first — an evaluator that assumed the friendlier
 * outcome would quietly inflate the advisor's own accuracy stats.
 *
 * If neither level is touched within `evaluateAfterCandles` candles, the
 * signal resolves EXPIRED (not INCORRECT) at the last available close —
 * a setup that went nowhere is a different failure mode than one that hit
 * its stop, and collapsing them would hide that distinction from the
 * accuracy dashboard.
 */
import type { Candle } from "./indicators";

export interface EvaluableSignal {
  action: "BUY" | "SELL";
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  evaluateAfterCandles: number;
}

export interface EvaluationResult {
  status: "CORRECT" | "INCORRECT" | "EXPIRED";
  exitPrice: number;
  maePct: number;
  mfePct: number;
}

function round8(v: number) {
  return Math.round(v * 1e8) / 1e8;
}
function round4(v: number) {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * `candlesSinceEntry` must already be sorted oldest-first and contain only
 * fully-closed candles at or after entry. Returns null if the signal is
 * still genuinely pending (fewer than `evaluateAfterCandles` candles have
 * printed yet, and neither level has been touched).
 */
export function evaluateSignal(
  signal: EvaluableSignal,
  candlesSinceEntry: Candle[],
): EvaluationResult | null {
  const {
    action,
    entryPrice: entry,
    takeProfit: tp,
    stopLoss: sl,
    evaluateAfterCandles: maxCandles,
  } = signal;

  const window = candlesSinceEntry.slice(0, maxCandles);
  const isBuy = action === "BUY";
  let maePct = 0;
  let mfePct = 0;

  for (const candle of window) {
    const { high, low } = candle;

    if (isBuy) {
      mfePct = Math.max(mfePct, ((high - entry) / entry) * 100);
      maePct = Math.max(maePct, ((entry - low) / entry) * 100);
    } else {
      mfePct = Math.max(mfePct, ((entry - low) / entry) * 100);
      maePct = Math.max(maePct, ((high - entry) / entry) * 100);
    }

    const hitTp = isBuy ? high >= tp : low <= tp;
    const hitSl = isBuy ? low <= sl : high >= sl;

    // Both levels touched within the same candle: assume the worse outcome.
    if (hitSl) {
      return { status: "INCORRECT", exitPrice: round8(sl), maePct: round4(maePct), mfePct: round4(mfePct) };
    }
    if (hitTp) {
      return { status: "CORRECT", exitPrice: round8(tp), maePct: round4(maePct), mfePct: round4(mfePct) };
    }
  }

  if (window.length >= maxCandles) {
    const lastClose = window[window.length - 1].close;
    return { status: "EXPIRED", exitPrice: round8(lastClose), maePct: round4(maePct), mfePct: round4(mfePct) };
  }

  return null;
}
