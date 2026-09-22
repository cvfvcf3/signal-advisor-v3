import type { Candle } from "./indicators";
import { toInstId, toSwapInstId } from "./config";

const BASE = "https://www.okx.com";

type CacheEntry = { at: number; value: unknown };
const globalForCache = globalThis as typeof globalThis & {
  __signalAdvisorCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> =
  globalForCache.__signalAdvisorCache ?? new Map();
globalForCache.__signalAdvisorCache = cache;

async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function okxGetOnce<T = unknown>(path: string, timeoutMs: number): Promise<T[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OKX ${res.status} for ${path}`);
    const json = (await res.json()) as { code?: string; msg?: string; data?: T[] };
    if (json.code && json.code !== "0") {
      throw new Error(`OKX error ${json.code}: ${json.msg ?? "unknown"}`);
    }
    return json.data ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One retry on transient failures (timeout/network/5xx) with a short delay.
 * A rate limit tick that hits 7 symbols x 4 bars x 3 endpoints in parallel
 * is exactly the kind of burst that occasionally trips a single flaky
 * request; without this, one hiccup drops that symbol's whole reading.
 */
async function okxGet<T = unknown>(path: string, timeoutMs = 9000): Promise<T[]> {
  try {
    return await okxGetOnce<T>(path, timeoutMs);
  } catch (err) {
    const message = (err as Error).message ?? "";
    const transient =
      (err as Error).name === "AbortError" ||
      /fetch failed|ECONNRESET|ETIMEDOUT|OKX 429|OKX 5\d\d/.test(message);
    if (!transient) throw err;
    const delay = /OKX 429/.test(message) ? 1200 : 400;
    await new Promise((r) => setTimeout(r, delay));
    return okxGetOnce<T>(path, timeoutMs);
  }
}

function toCandles(rows: string[][]): Candle[] {
  // OKX returns newest first -> flip to oldest first.
  return rows
    .map((r) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .filter((c) => Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
}

const BAR_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
  "1W": 7 * 24 * 60 * 60_000,
};

const CANDLE_TTL: Record<string, number> = {
  "5m": 45_000,
  "15m": 90_000,
  "1H": 240_000,
  "4H": 600_000,
  "1D": 900_000,
  // Weekly candles only close once a week; an hour of staleness is a
  // non-issue and saves a request on every single tick.
  "1W": 3_600_000,
};

export async function getCandles(
  symbol: string,
  bar: string,
  limit = 200,
): Promise<Candle[]> {
  const inst = toInstId(symbol);
  return cached(`candles:${inst}:${bar}:${limit}`, CANDLE_TTL[bar] ?? 60_000, async () => {
    const rows = await okxGet<string[]>(
      `/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=${limit}`,
    );
    const candles = toCandles(rows);
    const barMs = BAR_MS[bar] ?? 60_000;
    const now = Date.now();
    // Never feed a still-forming candle into the signal engine. This is a
    // hard anti-repainting boundary, not merely a UI convention.
    return candles.filter((c) => c.time + barMs <= now);
  });
}

/** Fresh, fully-closed candles used when resolving pending signals. */
export async function getCandlesSince(
  symbol: string,
  bar: string,
  sinceMs: number,
): Promise<Candle[]> {
  const inst = toInstId(symbol);
  const rows = await okxGet<string[]>(
    `/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=300`,
  );
  const barMs = BAR_MS[bar] ?? 60_000;
  const now = Date.now();
  return toCandles(rows)
    .filter((c) => c.time + barMs <= now)
    .filter((c) => c.time >= sinceMs - barMs);
}

export type OrderBook = {
  bids: [number, number][];
  asks: [number, number][];
};

export async function getOrderBook(symbol: string): Promise<OrderBook | null> {
  const inst = toInstId(symbol);
  try {
    return await cached(`book:${inst}`, 20_000, async () => {
      const data = await okxGet<{ bids: string[][]; asks: string[][] }>(
        `/api/v5/market/books?instId=${inst}&sz=50`,
      );
      const top = data[0];
      if (!top) return null;
      const map = (rows: string[][]): [number, number][] =>
        rows.map((r) => [Number(r[0]), Number(r[1])]);
      return { bids: map(top.bids ?? []), asks: map(top.asks ?? []) };
    });
  } catch {
    return null;
  }
}

export type FundingInfo = { current: number; history: number[] };

export async function getFunding(symbol: string): Promise<FundingInfo | null> {
  const inst = toSwapInstId(symbol);
  try {
    return await cached(`funding:${inst}`, 600_000, async () => {
      const rows = await okxGet<{ fundingRate: string; realizedRate?: string }>(
        `/api/v5/public/funding-rate-history?instId=${inst}&limit=40`,
      );
      const history = rows
        .map((r) => Number(r.realizedRate ?? r.fundingRate))
        .filter((n) => Number.isFinite(n))
        .reverse();
      const currentRows = await okxGet<{ fundingRate: string }>(
        `/api/v5/public/funding-rate?instId=${inst}`,
      );
      const current = Number(currentRows[0]?.fundingRate ?? history.at(-1) ?? 0);
      return { current, history };
    });
  } catch {
    return null;
  }
}

export type OpenInterestInfo = { current: number; history: number[] };

export async function getOpenInterest(
  symbol: string,
): Promise<OpenInterestInfo | null> {
  const ccy = symbol.split("/")[0];
  try {
    return await cached(`oi:${ccy}`, 600_000, async () => {
      const rows = await okxGet<string[]>(
        `/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`,
      );
      const history = rows
        .map((r) => Number(r[1]))
        .filter((n) => Number.isFinite(n))
        .reverse();
      if (history.length === 0) return null;
      return { current: history[history.length - 1], history };
    });
  } catch {
    return null;
  }
}

export async function getTickerPrice(symbol: string): Promise<number | null> {
  const inst = toInstId(symbol);
  try {
    return await cached(`ticker:${inst}`, 15_000, async () => {
      const rows = await okxGet<{ last: string }>(
        `/api/v5/market/ticker?instId=${inst}`,
      );
      const last = Number(rows[0]?.last);
      return Number.isFinite(last) ? last : null;
    });
  } catch {
    return null;
  }
}
