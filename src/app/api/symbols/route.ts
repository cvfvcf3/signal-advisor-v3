import { MODES, MODE_CONFIG, SYMBOLS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  await loadRuntimeConfig();
  return Response.json({
    symbols: SYMBOLS,
    modes: MODES,
    mode_config: Object.fromEntries(
      MODES.map((m) => [
        m,
        {
          bar: MODE_CONFIG[m].bar,
          htf: MODE_CONFIG[m].htf,
          label: MODE_CONFIG[m].label,
          min_confidence: MODE_CONFIG[m].minConfidence,
          target_pct: MODE_CONFIG[m].successMovePct * 100,
          evaluate_after_candles: MODE_CONFIG[m].evaluateAfterCandles,
          cooldown_minutes: MODE_CONFIG[m].cooldownMinutes,
          weights: MODE_CONFIG[m].weights,
        },
      ]),
    ),
  });
}
