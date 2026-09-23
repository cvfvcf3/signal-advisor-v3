"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LayerBars from "@/components/LayerBars";
import {
  parseLayers,
  type AccuracyDTO,
  type LogDTO,
  type ReadingDTO,
  type SignalDTO,
  type SymbolsDTO,
} from "@/lib/types";

const actionColor = (action: string) =>
  action === "BUY"
    ? "text-emerald-400"
    : action === "SELL"
      ? "text-rose-400"
      : "text-slate-400";

const statusStyle = (status: string) => {
  switch (status) {
    case "CORRECT":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "INCORRECT":
      return "bg-rose-500/15 text-rose-400 border-rose-500/30";
    case "EXPIRED":
      return "bg-slate-500/15 text-slate-400 border-slate-500/30";
    default:
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  }
};

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export default function Dashboard() {
  const [meta, setMeta] = useState<SymbolsDTO | null>(null);
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [mode, setMode] = useState("scalp");
  const [readings, setReadings] = useState<ReadingDTO[]>([]);
  const [allSignals, setAllSignals] = useState<SignalDTO[]>([]);
  const [journal, setJournal] = useState<SignalDTO[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyDTO | null>(null);
  const [globalAccuracy, setGlobalAccuracy] = useState<AccuracyDTO | null>(null);
  const [logs, setLogs] = useState<LogDTO[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [r, s, j, a, g, l] = await Promise.all([
        getJSON<ReadingDTO[]>("/api/readings"),
        getJSON<SignalDTO[]>("/api/signals?limit=60"),
        getJSON<SignalDTO[]>(
          `/api/signals?symbol=${encodeURIComponent(symbol)}&mode=${mode}&limit=25`,
        ),
        getJSON<AccuracyDTO>(
          `/api/accuracy?symbol=${encodeURIComponent(symbol)}&mode=${mode}`,
        ),
        getJSON<AccuracyDTO>("/api/accuracy"),
        getJSON<LogDTO[]>("/api/logs?limit=25"),
      ]);
      setReadings(r);
      setAllSignals(s);
      setJournal(j);
      setAccuracy(a);
      setGlobalAccuracy(g);
      setLogs(l);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [symbol, mode]);

  const runScan = useCallback(
    async () => {
      setScanning(true);
      try {
        await fetch("/api/tick", { method: "POST" });
      } catch {
        /* ignore, refresh will surface state */
      } finally {
        setScanning(false);
        await refresh();
      }
    },
    [refresh],
  );

  useEffect(() => {
    getJSON<SymbolsDTO>("/api/symbols")
      .then((m) => setMeta(m))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First visit: kick the engine so the board has data, then poll.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void runScan();
    const scanTimer = setInterval(() => void runScan(), 90_000);
    const refreshTimer = setInterval(() => void refresh(), 15_000);
    return () => {
      clearInterval(scanTimer);
      clearInterval(refreshTimer);
    };
  }, [runScan, refresh]);

  const current = useMemo(
    () => readings.find((r) => r.symbol === symbol && r.mode === mode) ?? null,
    [readings, symbol, mode],
  );

  const modeMeta = meta?.mode_config?.[mode];
  const symbols = meta?.symbols ?? [symbol];
  const modes = meta?.modes ?? ["scalp", "day", "swing"];

  const toggleRow = (key: string) =>
    setOpenRow((prev) => (prev === key ? null : key));

  const renderDetail = (row: SignalDTO, colSpan: number) => {
    const layers = parseLayers(row.layers_snapshot);
    return (
      <tr className="bg-slate-950/60">
        <td colSpan={colSpan} className="px-4 py-4">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">
                Layers at signal time
              </p>
              <LayerBars layers={layers} />
            </div>
            <div className="grid h-fit grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <Detail label="Signal id" value={row.signal_id.slice(0, 8)} />
              <Detail label="Target move" value={`${fmtNum(row.success_move_pct, 2)}%`} />
              <Detail label="Exit price" value={fmtNum(row.exit_price, 6)} />
              <Detail
                label="Evaluated over"
                value={`${row.evaluate_after_candles ?? "--"} candles`}
              />
              <Detail label="MFE" value={`${fmtNum(row.mfe_pct, 2)}%`} />
              <Detail label="MAE" value={`${fmtNum(row.mae_pct, 2)}%`} />
              <Detail label="Created" value={fmtTime(row.created_at)} />
              <Detail label="Resolved" value={fmtTime(row.resolved_at)} />
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Signal Advisor <span className="text-amber-400">v3</span>
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            READ-ONLY · NO TRADING · 5-layer engine over live OKX market data ·
            multi-coin, multi-mode
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-[11px] text-slate-500">
            <div>last refresh {lastRefresh ? fmtTime(lastRefresh.toISOString()) : "--"}</div>
            <div>{error ? <span className="text-rose-400">{error}</span> : "auto every 15s"}</div>
          </div>
          <button
            onClick={() => void runScan()}
            disabled={scanning}
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Run scan"}
          </button>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Signals logged" value={fmtNum(globalAccuracy?.total, 0)} />
        <Stat
          label="Hit rate (all)"
          value={
            globalAccuracy?.accuracy_pct != null
              ? `${globalAccuracy.accuracy_pct}%`
              : "--"
          }
          tone="accent"
        />
        <Stat label="Correct" value={fmtNum(globalAccuracy?.correct, 0)} tone="bull" />
        <Stat label="Incorrect" value={fmtNum(globalAccuracy?.incorrect, 0)} tone="bear" />
        <Stat label="Pending" value={fmtNum(globalAccuracy?.pending, 0)} />
      </section>

      <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            Live conviction matrix
          </h2>
          <span className="text-[11px] text-slate-500">
            tap a cell to inspect that coin / mode
          </span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[110px_repeat(3,1fr)] gap-2 pb-2 text-[11px] uppercase tracking-wider text-slate-500">
              <span>Coin</span>
              {modes.map((m) => (
                <span key={m}>
                  {m}
                  <span className="ml-1 text-slate-600">
                    {meta?.mode_config?.[m]?.bar}
                  </span>
                </span>
              ))}
            </div>
            <div className="space-y-2">
              {symbols.map((s) => (
                <div key={s} className="grid grid-cols-[110px_repeat(3,1fr)] gap-2">
                  <div className="flex items-center text-sm font-medium text-slate-300">
                    {s.replace("/USDT", "")}
                    <span className="ml-1 text-[10px] text-slate-600">USDT</span>
                  </div>
                  {modes.map((m) => {
                    const cell = readings.find(
                      (r) => r.symbol === s && r.mode === m,
                    );
                    const selected = s === symbol && m === mode;
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setSymbol(s);
                          setMode(m);
                        }}
                        className={`rounded-lg border px-3 py-2 text-left transition ${
                          selected
                            ? "border-amber-500/60 bg-amber-500/10"
                            : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span
                            className={`text-sm font-semibold ${actionColor(
                              cell?.action ?? "WAIT",
                            )}`}
                          >
                            {cell?.action ?? "--"}
                          </span>
                          <span className="font-mono text-xs text-slate-400">
                            {cell ? `${cell.confidence.toFixed(1)}%` : "--"}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={
                              (cell?.action ?? "WAIT") === "SELL"
                                ? "h-full bg-rose-500/70"
                                : "h-full bg-emerald-500/70"
                            }
                            style={{ width: `${cell?.confidence ?? 0}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200"
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200"
            >
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {modeMeta ? (
            <p className="mt-2 text-[11px] text-slate-500">
              {modeMeta.label} · confirm {modeMeta.htf.join(", ")} · target{" "}
              {modeMeta.target_pct.toFixed(2)}% · min conf {modeMeta.min_confidence}%
            </p>
          ) : null}

          <div className="mt-4 flex items-end justify-between">
            <div>
              <div className={`text-3xl font-bold ${actionColor(current?.action ?? "WAIT")}`}>
                {current?.action ?? "--"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                entry {fmtNum(current?.entry_price, 6)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl font-bold text-slate-100">
                {current ? `${current.confidence.toFixed(1)}` : "--"}
                <span className="text-base text-slate-500">%</span>
              </div>
              <div className="text-[11px] text-slate-500">
                updated {fmtTime(current?.updated_at)}
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-4 text-xs">
            <span className="text-emerald-400">
              TP {fmtNum(current?.take_profit, 6)}
            </span>
            <span className="text-rose-400">
              SL {fmtNum(current?.stop_loss, 6)}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Correct" value={fmtNum(accuracy?.correct, 0)} tone="bull" />
            <MiniStat label="Incorrect" value={fmtNum(accuracy?.incorrect, 0)} tone="bear" />
            <MiniStat
              label="Accuracy"
              value={accuracy?.accuracy_pct != null ? `${accuracy.accuracy_pct}%` : "--"}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Pending" value={fmtNum(accuracy?.pending, 0)} />
            <MiniStat label="Avg MFE" value={`${fmtNum(accuracy?.avg_mfe_pct, 2)}%`} />
            <MiniStat label="Avg MAE" value={`${fmtNum(accuracy?.avg_mae_pct, 2)}%`} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Layer breakdown (live) · {symbol} · {mode}
          </h2>
          <LayerBars layers={parseLayers(current?.layers)} />
          {current ? (
            <div className="mt-4 flex gap-6 border-t border-slate-800 pt-3 text-xs text-slate-400">
              <span>
                weighted bull{" "}
                <span className="font-mono text-emerald-400">
                  {current.bullish_score.toFixed(2)}
                </span>
              </span>
              <span>
                weighted bear{" "}
                <span className="font-mono text-rose-400">
                  {current.bearish_score.toFixed(2)}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">
            All signals · every coin, every mode
          </h2>
          <span className="text-[11px] text-slate-500">tap a row for layer detail</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                {["Time", "Symbol", "Mode", "Action", "Conf", "Entry", "TP", "SL", "Status"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {allSignals.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                    No signals yet — the engine publishes one once a setup clears the
                    confidence floor.
                  </td>
                </tr>
              ) : null}
              {allSignals.map((row) => {
                const key = `all-${row.id}`;
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => toggleRow(key)}
                      className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-2 text-slate-400">{fmtTime(row.created_at)}</td>
                      <td className="px-4 py-2 text-slate-200">{row.symbol}</td>
                      <td className="px-4 py-2">
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                          {row.mode}
                        </span>
                      </td>
                      <td className={`px-4 py-2 font-semibold ${actionColor(row.action)}`}>
                        {row.action}
                      </td>
                      <td className="px-4 py-2 font-mono">{row.confidence.toFixed(1)}</td>
                      <td className="px-4 py-2 font-mono">{fmtNum(row.entry_price, 6)}</td>
                      <td className="px-4 py-2 font-mono text-emerald-400">
                        {fmtNum(row.take_profit, 6)}
                      </td>
                      <td className="px-4 py-2 font-mono text-rose-400">
                        {fmtNum(row.stop_loss, 6)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${statusStyle(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                    {openRow === key ? renderDetail(row, 9) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-200">
              Journal · {symbol} · {mode}
            </h2>
            <span className="text-[11px] text-slate-500">tap a row for layer detail</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  {["Time", "Action", "Conf", "Entry", "TP", "SL", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {journal.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      No history for this pair yet.
                    </td>
                  </tr>
                ) : null}
                {journal.map((row) => {
                  const key = `journal-${row.id}`;
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => toggleRow(key)}
                        className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-2 text-slate-400">{fmtTime(row.created_at)}</td>
                        <td className={`px-4 py-2 font-semibold ${actionColor(row.action)}`}>
                          {row.action}
                        </td>
                        <td className="px-4 py-2 font-mono">{row.confidence.toFixed(1)}</td>
                        <td className="px-4 py-2 font-mono">{fmtNum(row.entry_price, 6)}</td>
                        <td className="px-4 py-2 font-mono text-emerald-400">
                          {fmtNum(row.take_profit, 6)}
                        </td>
                        <td className="px-4 py-2 font-mono text-rose-400">
                          {fmtNum(row.stop_loss, 6)}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${statusStyle(row.status)}`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                      {openRow === key ? renderDetail(row, 7) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-200">Activity log</h2>
          </div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto px-4 py-3">
            {logs.length === 0 ? (
              <p className="text-xs text-slate-500">No activity yet.</p>
            ) : null}
            {logs.map((l) => (
              <div key={l.id} className="flex gap-2 text-[11px]">
                <span className="shrink-0 font-mono text-slate-600">
                  {fmtTime(l.time)}
                </span>
                <span
                  className={
                    l.level === "signal"
                      ? "text-amber-300"
                      : l.level === "warn"
                        ? "text-orange-400"
                        : l.level === "error"
                          ? "text-rose-400"
                          : "text-slate-400"
                  }
                >
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-8 text-center text-[11px] text-slate-600">
        Educational analytics only. Not financial advice. Market data: OKX public API.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "bull" | "bear" | "accent";
}) {
  const color =
    tone === "bull"
      ? "text-emerald-400"
      : tone === "bear"
        ? "text-rose-400"
        : tone === "accent"
          ? "text-amber-400"
          : "text-slate-100";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "bull" | "bear";
}) {
  const color =
    tone === "bull"
      ? "text-emerald-400"
      : tone === "bear"
        ? "text-rose-400"
        : "text-slate-200";
  return (
    <div className="rounded-lg bg-slate-950/70 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800/60 pb-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-300">{value}</span>
    </div>
  );
}
