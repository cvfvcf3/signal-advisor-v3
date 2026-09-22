import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { notificationOutbox, signals } from "@/db/schema";
import { TELEGRAM_CONFIG } from "./config";
import type { Layers } from "./layers";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export type NotifiableSignal = {
  signalId: string;
  symbol: string;
  mode: string;
  action: "BUY" | "SELL";
  confidence: number;
  entryPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  layers: Layers;
};

export function formatMessage(signal: NotifiableSignal): string {
  const layerLines = Object.entries(signal.layers).map(([name, reading]) =>
    `  ${name}: bull=${reading.bullish_score} bear=${reading.bearish_score}`,
  );
  return [
    `${signal.action} signal — ${signal.symbol} (${signal.mode})`,
    `Confidence: ${signal.confidence}`,
    `Entry: ${signal.entryPrice}`,
    `Take-Profit: ${signal.takeProfit ?? "--"}`,
    `Stop-Loss: ${signal.stopLoss ?? "--"}`,
    "",
    "Layers:",
    ...(layerLines.length ? layerLines : ["  (no layer detail)"]),
    "",
    "Read-only advisor — no trade was placed.",
  ].join("\n");
}

/**
 * Exponential backoff for a failed Telegram send, capped at 1 hour so a
 * long-dead webhook doesn't leave jobs retrying once a week. attempts=1 is
 * the first failure. 5s, 10s, 20s, 40s, 80s, 160s, 320s, 640s, then capped.
 */
export function computeBackoffDelayMs(attempts: number): number {
  const ONE_HOUR_MS = 60 * 60_000;
  return Math.min(ONE_HOUR_MS, 5_000 * 2 ** Math.min(attempts, 8));
}

async function sendMessage(text: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || "";
  if (!botToken || !chatId) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
      cache: "no-store",
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Durable at-least-once notification worker backed by Postgres. */
export async function processNotificationOutbox(limit = 25): Promise<number> {
  if (!TELEGRAM_CONFIG.enabled) return 0;
  const now = new Date();
  const jobs = await db.select().from(notificationOutbox)
    .where(and(eq(notificationOutbox.channel, "telegram"), or(eq(notificationOutbox.status, "PENDING"), and(eq(notificationOutbox.status, "FAILED"), lte(notificationOutbox.nextAttemptAt, now)))))
    .orderBy(notificationOutbox.createdAt)
    .limit(limit);
  if (!jobs.length) return 0;

  const ids = jobs.map((j) => j.signalId);
  const rows = await db.select().from(signals).where(inArray(signals.signalId, ids));
  const byId = new Map(rows.filter((r) => ids.includes(r.signalId)).map((r) => [r.signalId, r]));
  let sent = 0;

  for (const job of jobs) {
    const signal = byId.get(job.signalId);
    if (!signal) {
      await db.update(notificationOutbox).set({ status: "FAILED", lastError: "signal not found", attempts: job.attempts + 1, nextAttemptAt: new Date(Date.now() + 60_000) }).where(eq(notificationOutbox.id, job.id));
      continue;
    }
    const ok = await sendMessage(formatMessage({
      signalId: signal.signalId, symbol: signal.symbol, mode: signal.mode,
      action: signal.action as "BUY" | "SELL", confidence: signal.confidence,
      entryPrice: signal.entryPrice, takeProfit: signal.takeProfit, stopLoss: signal.stopLoss,
      layers: (signal.layersSnapshot ?? {}) as Layers,
    }));
    if (ok) {
      await db.update(notificationOutbox).set({ status: "SENT", sentAt: new Date(), attempts: job.attempts + 1, lastError: null }).where(eq(notificationOutbox.id, job.id));
      await db.update(signals).set({ notified: true }).where(eq(signals.signalId, signal.signalId));
      sent += 1;
    } else {
      const attempts = job.attempts + 1;
      const delay = computeBackoffDelayMs(attempts);
      await db.update(notificationOutbox).set({ status: "FAILED", attempts, lastError: "telegram delivery failed", nextAttemptAt: new Date(Date.now() + delay) }).where(eq(notificationOutbox.id, job.id));
    }
  }
  return sent;
}
