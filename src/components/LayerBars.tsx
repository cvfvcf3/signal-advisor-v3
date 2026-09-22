"use client";

import type { LayersDTO } from "@/lib/types";

const LABELS: Record<string, string> = {
  technical: "Technical",
  multi_timeframe: "Multi-timeframe",
  orderbook: "Order book",
  market_structure: "Market structure",
  smc: "Smart money (SMC)",
};

export default function LayerBars({
  layers,
  compact = false,
}: {
  layers: LayersDTO | null;
  compact?: boolean;
}) {
  if (!layers || Object.keys(layers).length === 0) {
    return (
      <p className="text-xs text-slate-500">No layer reading available yet.</p>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {Object.entries(layers).map(([name, layer]) => {
        const bull = Number(layer?.bullish_score ?? 0);
        const bear = Number(layer?.bearish_score ?? 0);
        const total = Math.max(bull + bear, 1);
        return (
          <div key={name}>
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
              <span>{LABELS[name] ?? name}</span>
              <span className="font-mono">
                <span className="text-emerald-400">{bull.toFixed(0)}</span>
                <span className="text-slate-600"> / </span>
                <span className="text-rose-400">{bear.toFixed(0)}</span>
              </span>
            </div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="bg-emerald-500/80"
                style={{ width: `${(bull / total) * 100}%` }}
              />
              <div
                className="bg-rose-500/80"
                style={{ width: `${(bear / total) * 100}%` }}
              />
            </div>
            {!compact && layer?.details ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {Object.entries(layer.details)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded bg-slate-800/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                    >
                      {k.replace(/_/g, " ")}: {String(v)}
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
