/**
 * Canonical DTO shapes returned by the API routes and consumed by the
 * dashboard. Kept separate from the Drizzle row types (db/schema.ts) so the
 * wire format (snake_case, ISO date strings) can stay stable even if the
 * internal column types change.
 */

export type LayerResultDTO = {
  bullish_score: number;
  bearish_score: number;
  details: Record<string, string | number | boolean | null>;
};

export type LayersDTO = Record<string, LayerResultDTO>;

export type SignalDTO = {
  id: number;
  signal_id: string;
  symbol: string;
  mode: string;
  action: string;
  confidence: number;
  entry_price: number;
  take_profit: number | null;
  stop_loss: number | null;
  success_move_pct: number | null;
  evaluate_after_candles: number | null;
  status: string;
  exit_price: number | null;
  mae_pct: number | null;
  mfe_pct: number | null;
  resolved_at: string | null;
  created_at: string;
  notified: boolean;
  layers_snapshot: LayersDTO | string | null;
};

export type ReadingDTO = {
  symbol: string;
  mode: string;
  action: string;
  confidence: number;
  entry_price: number;
  take_profit: number | null;
  stop_loss: number | null;
  bullish_score: number;
  bearish_score: number;
  layers: LayersDTO | string | null;
  updated_at: string;
};

export type AccuracyDTO = {
  symbol: string;
  mode: string;
  total: number;
  correct: number;
  incorrect: number;
  pending: number;
  expired: number;
  accuracy_pct: number | null;
  avg_confidence: number | null;
  avg_mfe_pct: number | null;
  avg_mae_pct: number | null;
};

export type LogDTO = {
  id: number;
  level: string;
  message: string;
  time: string;
};

export type ModeMeta = {
  bar: string;
  htf: string[];
  label: string;
  min_confidence: number;
  target_pct: number;
  evaluate_after_candles: number;
  cooldown_minutes: number;
  weights: Record<string, number>;
};

export type SymbolsDTO = {
  symbols: string[];
  modes: string[];
  mode_config: Record<string, ModeMeta>;
};

export type TickResultDTO = {
  ok: boolean;
  scanned: number;
  emitted: number;
  resolved: number;
  notified: number;
  errors: string[];
  durationMs: number;
};

export function parseLayers(
  value: LayersDTO | string | null | undefined,
): LayersDTO | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as LayersDTO;
    } catch {
      return null;
    }
  }
  return value;
}
