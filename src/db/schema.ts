import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Every signal the engine has ever emitted (immutable journal).
 *
 * `status` lifecycle: PENDING -> CORRECT | INCORRECT | EXPIRED.
 * EXPIRED means neither take-profit nor stop-loss was touched within the
 * signal's evaluation window (distinct from INCORRECT, which means the
 * stop-loss was hit) — kept separate so accuracy stats aren't skewed by
 * setups that simply went nowhere.
 */
export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    signalId: text("signal_id").notNull(),
    symbol: text("symbol").notNull(),
    mode: text("mode").notNull(),
    action: text("action").notNull(), // BUY | SELL
    confidence: doublePrecision("confidence").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    takeProfit: doublePrecision("take_profit"),
    stopLoss: doublePrecision("stop_loss"),
    successMovePct: doublePrecision("success_move_pct"),
    evaluateAfterCandles: integer("evaluate_after_candles"),
    status: text("status").notNull().default("PENDING"), // PENDING | CORRECT | INCORRECT | EXPIRED
    exitPrice: doublePrecision("exit_price"),
    maePct: doublePrecision("mae_pct"),
    mfePct: doublePrecision("mfe_pct"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    layersSnapshot: jsonb("layers_snapshot"),
    /** Whether a Telegram alert was already sent for this signal (avoids duplicate sends). */
    notified: boolean("notified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("signals_symbol_mode_idx").on(t.symbol, t.mode),
    index("signals_created_idx").on(t.createdAt),
    index("signals_status_idx").on(t.status),
    uniqueIndex("signals_signal_id_idx").on(t.signalId),
  ],
);

/** Latest live layer reading per symbol + mode (overwritten each tick). */
export const readings = pgTable(
  "readings",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    mode: text("mode").notNull(),
    action: text("action").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    takeProfit: doublePrecision("take_profit"),
    stopLoss: doublePrecision("stop_loss"),
    bullishScore: doublePrecision("bullish_score").notNull().default(0),
    bearishScore: doublePrecision("bearish_score").notNull().default(0),
    layers: jsonb("layers"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("readings_symbol_mode_idx").on(t.symbol, t.mode)],
);

/** Rolling activity log shown at the bottom of the dashboard. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    level: text("level").notNull().default("info"), // info | signal | warn | error
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("activity_log_created_idx").on(t.createdAt)],
);

/** Durable, database-backed runtime configuration shared by all instances. */
export const appConfig = pgTable(
  "app_config",
  {
    id: integer("id").primaryKey(),
    modeConfig: jsonb("mode_config").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
);

/** Transactional notification outbox. A signal has at most one notification job. */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: serial("id").primaryKey(),
    signalId: text("signal_id").notNull(),
    channel: text("channel").notNull().default("telegram"),
    status: text("status").notNull().default("PENDING"), // PENDING | SENT | FAILED
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_outbox_signal_channel_idx").on(t.signalId, t.channel),
    index("notification_outbox_status_attempt_idx").on(t.status, t.nextAttemptAt),
  ],
);

export type SignalRow = typeof signals.$inferSelect;
export type ReadingRow = typeof readings.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;
export type AppConfigRow = typeof appConfig.$inferSelect;
export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;
