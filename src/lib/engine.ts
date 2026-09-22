import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { activityLog, notificationOutbox, readings, signals } from "@/db/schema";
import { MODES, MODE_CONFIG, SYMBOLS, type Mode } from "./config";
import { loadRuntimeConfig } from "./configStore";
import { buildReading, type MarketData } from "./layers";
import { getCandles, getCandlesSince, getFunding, getOpenInterest, getOrderBook } from "./okx";
import { type Candle } from "./indicators";
import { evaluateSignal } from "./evaluator";
import { processNotificationOutbox } from "./telegramNotifier";

const BARS = ["5m", "1H", "4H", "1D", "1W"] as const;
const BAR_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
  "1W": 7 * 24 * 60 * 60_000,
};

const globalForEngine = globalThis as typeof globalThis & {
  __signalAdvisorTick?: { running: boolean; lastRun: number };
};
const state = globalForEngine.__signalAdvisorTick ?? { running: false, lastRun: 0 };
globalForEngine.__signalAdvisorTick = state;

export async function log(message: string, level: "info" | "signal" | "warn" | "error" = "info") {
  await db.insert(activityLog).values({ message, level });
}

export async function acquireDistributedTickLock() {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      ["signal-advisor:global-tick:v2"],
    );
    if (!result.rows[0]?.locked) {
      client.release();
      return null;
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

export async function releaseDistributedTickLock(client: import("pg").PoolClient | null) {
  if (!client) return;
  try {
    await client.query("select pg_advisory_unlock(hashtext($1))", ["signal-advisor:global-tick:v2"]);
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [key]);
    if (!result.rows[0]?.locked) return null;
    return await fn();
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtext($1))", [key]); }
    finally { client.release(); }
  }
}

async function loadMarketData(symbol: string): Promise<MarketData> {
  const limitFor = (bar: (typeof BARS)[number]) => {
    if (bar === "5m") return 200;
    if (bar === "1W") return 104; // ~2 years of weekly candles is plenty for a trend read
    return 150;
  };
  const [c5, c1h, c4h, c1d, c1w] = await Promise.all(
    BARS.map((bar) => getCandles(symbol, bar, limitFor(bar)).catch(() => [] as Candle[])),
  );
  const [book, funding, oi] = await Promise.all([
    getOrderBook(symbol),
    getFunding(symbol),
    getOpenInterest(symbol),
  ]);
  return { symbol, candles: { "5m": c5, "1H": c1h, "4H": c4h, "1D": c1d, "1W": c1w }, book, funding, oi };
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type TickResult = {
  ok: boolean;
  scanned: number;
  emitted: number;
  resolved: number;
  notified: number;
  errors: string[];
  durationMs: number;
  skipped?: "running" | "throttled" | "distributed_lock";
};

export async function runTick(force = false): Promise<TickResult> {
  const started = Date.now();
  if (state.running) return { ok: true, scanned: 0, emitted: 0, resolved: 0, notified: 0, errors: ["tick already running"], durationMs: 0, skipped: "running" };
  if (!force && Date.now() - state.lastRun < 25_000) return { ok: true, scanned: 0, emitted: 0, resolved: 0, notified: 0, errors: ["throttled"], durationMs: 0, skipped: "throttled" };

  state.running = true;
  let lock: import("pg").PoolClient | null = null;
  const errors: string[] = [];
  let scanned = 0;
  let emitted = 0;
  let resolved = 0;
  let notified = 0;

  try {
    lock = await acquireDistributedTickLock();
    if (!lock) return { ok: true, scanned: 0, emitted: 0, resolved: 0, notified: 0, errors: ["another instance is running the tick"], durationMs: 0, skipped: "distributed_lock" };

    await loadRuntimeConfig();

    const perSymbol = await mapWithConcurrency(SYMBOLS, 3, async (symbol) => {
      try {
        const data = await loadMarketData(symbol);
        if ((data.candles["5m"]?.length ?? 0) < 60) {
          errors.push(`${symbol}: insufficient closed market data`);
          return 0;
        }
        let count = 0;
        for (const mode of MODES) {
          const cfg = MODE_CONFIG[mode];
          const reading = buildReading(data, mode, cfg);
          if (!reading) continue;
          scanned += 1;

          await db.insert(readings).values({
            symbol, mode, action: reading.action, confidence: reading.confidence,
            entryPrice: reading.entryPrice, takeProfit: reading.takeProfit, stopLoss: reading.stopLoss,
            bullishScore: reading.bullishScore, bearishScore: reading.bearishScore,
            layers: reading.layers, updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [readings.symbol, readings.mode],
            set: {
              action: reading.action, confidence: reading.confidence, entryPrice: reading.entryPrice,
              takeProfit: reading.takeProfit, stopLoss: reading.stopLoss, bullishScore: reading.bullishScore,
              bearishScore: reading.bearishScore, layers: reading.layers, updatedAt: new Date(),
            },
          });

          if (reading.action === "WAIT") continue;

          const [recent] = await db.select({ createdAt: signals.createdAt, status: signals.status })
            .from(signals)
            .where(and(eq(signals.symbol, symbol), eq(signals.mode, mode)))
            .orderBy(desc(signals.createdAt)).limit(1);
          const cooldownMs = cfg.cooldownMinutes * 60_000;
          const tooSoon = !!recent && Date.now() - new Date(recent.createdAt).getTime() < cooldownMs;
          const stillOpen = recent?.status === "PENDING";
          if (tooSoon || stillOpen) continue;

          const signalId = randomUUID();
          await db.transaction(async (tx) => {
            await tx.insert(signals).values({
              signalId, symbol, mode, action: reading.action, confidence: reading.confidence,
              entryPrice: reading.entryPrice, takeProfit: reading.takeProfit, stopLoss: reading.stopLoss,
              successMovePct: Math.round(cfg.successMovePct * 100 * 1000) / 1000,
              evaluateAfterCandles: cfg.evaluateAfterCandles, status: "PENDING", layersSnapshot: reading.layers,
            });
            if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID &&
                reading.confidence >= Number(process.env.TELEGRAM_MIN_CONFIDENCE ?? 70)) {
              await tx.insert(notificationOutbox).values({ signalId, channel: "telegram", status: "PENDING" });
            }
          });
          await log(`${reading.action} ${symbol} (${mode}) @ ${reading.entryPrice} - conf ${reading.confidence}%`, "signal");
          count += 1;
        }
        return count;
      } catch (err) {
        errors.push(`${symbol}: ${(err as Error).message}`);
        return 0;
      }
    });
    emitted = perSymbol.reduce((a, b) => a + b, 0);

    resolved = await resolvePending();
    notified = await processNotificationOutbox(25);

    await log(`tick completed - ${scanned} readings - ${emitted} new signals - ${resolved} resolved - ${notified} notified`);
    if (errors.length) await log(`tick warnings: ${errors.slice(0, 3).join(" | ")}`, "warn");
    await db.execute(sql`delete from activity_log where id not in (select id from activity_log order by created_at desc limit 200)`);

    state.lastRun = Date.now();
    return { ok: true, scanned, emitted, resolved, notified, errors, durationMs: Date.now() - started };
  } catch (err) {
    const message = (err as Error).message;
    try { await log(`tick failed: ${message}`, "error"); } catch {}
    return { ok: false, scanned, emitted, resolved, notified, errors: [...errors, message], durationMs: Date.now() - started };
  } finally {
    await releaseDistributedTickLock(lock);
    state.running = false;
  }
}

export async function resolvePending(): Promise<number> {
  const pending = await db.select().from(signals)
    .where(eq(signals.status, "PENDING"))
    .orderBy(signals.createdAt)
    .limit(500);
  if (pending.length === 0) return 0;

  let resolved = 0;
  const byKey = new Map<string, typeof pending>();
  for (const row of pending) {
    const key = `${row.symbol}|${row.mode}`;
    const list = byKey.get(key) ?? [];
    list.push(row); byKey.set(key, list);
  }

  for (const [key, rows] of byKey) {
    const [symbol, mode] = key.split("|");
    const cfg = MODE_CONFIG[mode as Mode];
    if (!cfg) continue;
    const barMs = BAR_MS[cfg.bar] ?? 0;
    const oldest = Math.min(...rows.map((r) => new Date(r.createdAt).getTime()));
    let candles: Candle[];
    try { candles = await getCandlesSince(symbol, cfg.bar, oldest); } catch { continue; }
    if (candles.length === 0) continue;

    for (const row of rows) {
      if (row.takeProfit == null || row.stopLoss == null) continue;
      const start = new Date(row.createdAt).getTime();
      const window = candles.filter((c) => c.time > start && c.time + barMs <= Date.now());
      const result = evaluateSignal({
        action: row.action as "BUY" | "SELL", entryPrice: row.entryPrice,
        takeProfit: row.takeProfit, stopLoss: row.stopLoss,
        evaluateAfterCandles: row.evaluateAfterCandles ?? 24,
      }, window);
      if (!result) continue;
      const changed = await db.update(signals).set({
        status: result.status, exitPrice: result.exitPrice, mfePct: result.mfePct,
        maePct: result.maePct, resolvedAt: new Date(),
      }).where(and(eq(signals.id, row.id), eq(signals.status, "PENDING"))).returning({ id: signals.id });
      if (!changed.length) continue;
      resolved += 1;
      await log(`${row.symbol} (${row.mode}) ${row.action} resolved ${result.status}`, result.status === "CORRECT" ? "signal" : "info");
    }
  }
  return resolved;
}
