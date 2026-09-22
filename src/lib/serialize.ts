import type { ReadingRow, SignalRow } from "@/db/schema";
import type { ReadingDTO, SignalDTO } from "@/lib/types";

export function toSignalDTO(row: SignalRow): SignalDTO {
  return {
    id: row.id,
    signal_id: row.signalId,
    symbol: row.symbol,
    mode: row.mode,
    action: row.action,
    confidence: row.confidence,
    entry_price: row.entryPrice,
    take_profit: row.takeProfit,
    stop_loss: row.stopLoss,
    success_move_pct: row.successMovePct,
    evaluate_after_candles: row.evaluateAfterCandles,
    status: row.status,
    exit_price: row.exitPrice,
    mae_pct: row.maePct,
    mfe_pct: row.mfePct,
    resolved_at: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
    notified: row.notified,
    layers_snapshot: row.layersSnapshot as SignalDTO["layers_snapshot"],
  };
}

export function toReadingDTO(row: ReadingRow): ReadingDTO {
  return {
    symbol: row.symbol,
    mode: row.mode,
    action: row.action,
    confidence: row.confidence,
    entry_price: row.entryPrice,
    take_profit: row.takeProfit,
    stop_loss: row.stopLoss,
    bullish_score: row.bullishScore,
    bearish_score: row.bearishScore,
    layers: row.layers as ReadingDTO["layers"],
    updated_at: new Date(row.updatedAt).toISOString(),
  };
}
