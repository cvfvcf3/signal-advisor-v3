# Project prompt: Signal Advisor (read-only crypto signal engine)

Use this as a single, complete prompt to hand to an AI coding assistant (or a developer) to
build the app from scratch. It describes exactly what was built, so pasting this in gets you
the same result.

## One-line brief

Build a **read-only**, multi-coin, multi-mode crypto signal advisor for OKX spot markets, using
Next.js (App Router) + TypeScript + Postgres (Drizzle ORM). It scores each (symbol, mode) pair
every tick, journals BUY/SELL signals with take-profit/stop-loss, and later self-grades each
signal against real closed candles. **No order-placing code anywhere** — only OKX's public
market-data endpoints are called.

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind v4
- Postgres via `drizzle-orm/node-postgres` + `pg`, schema managed with `drizzle-kit`
- No external exchange SDK (e.g. no `ccxt`) — a small typed client that calls OKX's public REST
  API directly (`/api/v5/market/candles`, `/api/v5/market/books`,
  `/api/v5/public/funding-rate-history`, `/api/v5/public/open-interest-volume`, etc.)
- `vitest` for unit tests of pure logic
- No other backend framework, no auth provider — two routes are protected by a single shared
  secret compared with `crypto.timingSafeEqual`

## Symbols & modes

- Symbols: `BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, ADA/USDT, DOGE/USDT`
- Modes, each with its own base timeframe, higher-timeframe confirmation, target move,
  risk/reward, minimum confidence, and cooldown:
  - `scalp` — 5m entries, 1H confirmation, ~0.6% target, RR 1.25, min confidence 62, 20 min cooldown
  - `day` — 1H entries, 4H confirmation, ~1.5% target, RR 1.5, min confidence 64, 90 min cooldown
  - `swing` — 4H entries, 1D confirmation, ~3% target, RR 1.6, min confidence 66, 360 min cooldown
- Each mode has its own per-layer weight map (see "Scoring layers"), summing to roughly 1, kept
  mutable at runtime so an admin route can retune them without a redeploy.

## Scoring layers (five, per (symbol, mode) reading)

1. **Technical** — EMA9/21/50 stack, MACD histogram, RSI (overbought/oversold/mild),
   volume-vs-20-period-average spike, and price position within the last 40 candles' range
   (breakout/breakdown zone). Produces a bullish/bearish score out of 100.
2. **Multi-timeframe** — for each configured higher timeframe, checks whether EMA20 > EMA50 and
   price > EMA50; the score is the fraction of higher timeframes agreeing bullish.
3. **Order book** — top-25-level bid/ask volume imbalance, spread %, and simple wall detection
   (one side's average level size exceeded 4x by a single level).
4. **Market structure** — funding rate and open interest, each turned into a z-score against
   their own recent history (pulled from OKX's history endpoints directly, **not** accumulated
   in process memory — see "Design notes" for why). Very positive funding = contrarian bearish
   tilt (crowded longs / squeeze risk); rising OI with price direction = continuation signal.
5. **Smart money concepts (SMC)** — fractal swing highs/lows (2-bar lookback), higher-high/
   higher-low structure bias, break-of-structure on the latest close, liquidity sweep detection
   (wick through a prior swing, body closes back inside), and 3-candle fair-value-gap detection.

Each layer returns `{ bullish_score, bearish_score, details }` (0–100 each, not necessarily
summing to 100). `buildReading()` combines them with the mode's weights into a net score, maps
that to a 0–100 confidence, and emits `BUY` / `SELL` / `WAIT`:
- `action = BUY` if `confidence >= minConfidence` and net score is positive
- `action = SELL` if `(100 - confidence) >= minConfidence` and net score is negative
- otherwise `WAIT` (no take-profit/stop-loss, not journaled)

Take-profit distance = `max(mode.successMovePct, 1.4 * ATR14%)`; stop-loss distance =
`take-profit distance / mode.rr`.

## Evaluator (path-aware, conservative)

Given a signal (`action`, `entryPrice`, `takeProfit`, `stopLoss`, `evaluateAfterCandles`) and the
closed candles printed since it was created, walk them oldest-first:
- Track running MFE% (best favorable excursion) and MAE% (worst adverse excursion) every candle.
- If a candle's high/low touches the stop-loss → resolve `INCORRECT` immediately.
- Else if it touches the take-profit → resolve `CORRECT` immediately.
- **If a single candle touches both levels, resolve `INCORRECT`** (assume stop-loss was hit
  first — there's no way to know the true intra-candle order from OHLC data, and assuming the
  friendlier outcome would inflate the advisor's own accuracy stats).
- If neither level is touched within `evaluateAfterCandles` candles, resolve `EXPIRED` (**not**
  `INCORRECT`) at the last close — a setup that went nowhere is a different failure mode than one
  that hit its stop, and should be reported separately.
- If fewer than `evaluateAfterCandles` closed candles have printed yet and neither level has been
  touched, return `null` (still genuinely pending).

This function must be pure (no DB/network) and unit-tested, including the both-levels-in-one-
candle tie-break, the EXPIRED-vs-INCORRECT distinction, and multi-candle resolution.

**Only evaluate against fully-closed candles** — a candle whose close time hasn't passed yet can
still have its high/low move, so including it would let a signal's outcome flicker between ticks
(a form of repainting).

## Data model (Postgres via Drizzle)

- **`signals`** — immutable-once-resolved journal of every emitted signal: `signal_id` (unique),
  `symbol`, `mode`, `action`, `confidence`, `entry_price`, `take_profit`, `stop_loss`,
  `success_move_pct`, `evaluate_after_candles`, `status` (`PENDING|CORRECT|INCORRECT|EXPIRED`),
  `exit_price`, `mae_pct`, `mfe_pct`, `resolved_at`, `layers_snapshot` (jsonb), `notified`
  (boolean, prevents duplicate Telegram sends), `created_at`. Indexes on `(symbol, mode)`,
  `created_at`, `status`, unique on `signal_id`.
- **`readings`** — latest live reading per `(symbol, mode)`, overwritten every tick (upsert on
  the unique `(symbol, mode)` pair): action, confidence, entry/TP/SL, bullish/bearish score,
  full layers jsonb, `updated_at`.
- **`activity_log`** — rolling log (`level: info|signal|warn|error`, `message`, `created_at`),
  trimmed to the most recent 200 rows at the end of every tick. Actually written to (not just
  kept in memory) so it survives restarts and is consistent across instances.

## Tick engine (`runTick(force?: boolean)`)

1. Guarded by a per-process in-memory lock (skip if already running) and a 25-second throttle
   unless `force` is true.
2. For each symbol (concurrency-limited, e.g. 3 at a time to respect OKX rate limits): fetch
   5m/1H/4H/1D candles, order book, funding, and open interest once per symbol (shared across
   all modes for that symbol to avoid redundant calls).
3. For each mode: build the reading, upsert it into `readings`. If `WAIT`, stop there. If
   `BUY`/`SELL`: check the most recent signal for this `(symbol, mode)` — skip if one is still
   `PENDING` or if the mode's cooldown hasn't elapsed since it was created; otherwise insert a
   new `PENDING` signal row, log it, and queue it for a Telegram notification.
4. After all symbols: resolve pending signals — group `PENDING` rows by `(symbol, mode)`, fetch
   candles since the oldest one's `created_at`, filter to fully-closed candles, run the evaluator
   per row, and update `status`/`exit_price`/`mae_pct`/`mfe_pct`/`resolved_at` for anything it
   resolves.
5. Send any queued Telegram notifications (only if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are
   set, and only above a configurable minimum confidence); mark those signals `notified = true`
   in one batch update so a signal is never alerted twice.
6. Log a tick summary, trim `activity_log` to 200 rows, record the tick timestamp, return
   `{ ok, scanned, emitted, resolved, notified, errors, durationMs }`.
7. Per-symbol errors are caught and collected, not thrown — one symbol failing (bad data, OKX
   hiccup) must not abort the whole tick.

## Exchange client

Small typed wrapper around OKX's public REST API. One retry with a short delay on transient
failures (timeout/network/5xx) — a parallel tick hitting 7 symbols × several endpoints is exactly
the kind of burst where one flaky request shouldn't drop an entire symbol's reading. Each
endpoint is cached with a short TTL to avoid redundant calls within the same tick. Needs:
`getCandles(symbol, bar, limit)`, `getCandlesSince(symbol, bar, sinceMs)`, `getOrderBook(symbol)`,
`getFunding(symbol)` (current + history array), `getOpenInterest(symbol)` (current + history
array).

## API routes

- `GET /api/readings` — all current readings.
- `GET /api/current_signal?symbol=&mode=` — single current reading.
- `GET /api/signals?symbol=&mode=&status=&limit=` — signal history.
- `GET /api/signal/[id]` — one signal by `signal_id`, 404 if not found.
- `GET /api/accuracy?symbol=&mode=` — aggregate stats: total/correct/incorrect/pending/expired
  counts, accuracy % (correct / (correct+incorrect), excluding expired and pending), average
  confidence, average MFE%, average MAE%.
- `GET /api/export?symbol=&mode=&format=csv|json` — download signal history.
- `GET /api/symbols` — symbols, modes, and per-mode metadata (bar, higher timeframes, label, min
  confidence, target %, evaluate-after-candles, cooldown minutes, weights).
- `GET /api/logs?limit=` — recent activity log entries.
- `GET /api/health` — `{ ok: true }` if the DB is reachable.
- `GET|POST /api/tick?force=1` — runs a tick. A normal (unforced) call is open to anyone (the
  dashboard calls this itself from the browser) and just respects the 25s throttle. `force=1`
  bypasses the throttle and requires `Authorization: Bearer <TICK_SECRET>` **if**
  `TICK_SECRET` is set on the server; if it isn't set, `force=1` stays open (deliberate
  local/demo default — document this clearly, don't silently "fix" it into always requiring a
  secret, since that would break the dashboard's own scan button in dev).
- `POST /api/admin/reload-config` — the only route that mutates anything besides the signal
  journal, and even then only in-memory scoring weights, per-mode min-confidence, and cooldown
  minutes (allow-listed fields only, reject anything else with a 400 and a clear error). Requires
  `ADMIN_SECRET` to be set (503 if not) and a matching `Authorization: Bearer` header (401 if
  wrong/missing). Both secret checks must use a constant-time comparison
  (`crypto.timingSafeEqual`, padded to equal length first to avoid it throwing on a length
  mismatch), never `===`/`!==`, since a naive string comparison leaks timing information
  byte-by-byte.

## Notifications (optional)

Telegram alert on every newly emitted `BUY`/`SELL` signal, above a configurable minimum
confidence, formatted with action/symbol/mode/confidence/entry/TP/SL and a per-layer bull/bear
breakdown, ending with an explicit "Read-only advisor — no trade was placed." line. Reads the bot
token and chat id from environment variables only (never from the mutable in-memory config, so a
compromised admin call can't redirect alerts). Silently a no-op (returns nothing sent) if the env
vars aren't configured — the engine calls it unconditionally every tick without needing to check
first.

## Dashboard (single client component)

- Header with title, "read-only, no trading" disclaimer, last-refresh time, and a "Run scan"
  button that force-ticks.
- On first mount: fire an unforced tick immediately, then poll `/api/tick` (unforced) every ~90s
  and refresh all data every ~15s.
- Global stat cards: total signals, hit rate, correct, incorrect, pending.
- A "conviction matrix" grid — every symbol × every mode as a clickable cell showing action,
  confidence, and a small confidence bar — clicking selects that pair for the detail panel.
- Detail panel for the selected (symbol, mode): current action/confidence/entry/TP/SL, per-pair
  accuracy mini-stats (correct/incorrect/accuracy%/pending/avg MFE/avg MAE), and a live layer
  breakdown (bullish/bearish bar per layer plus a handful of its `details` as small tags).
- Two tables: all signals across every symbol/mode, and journal history filtered to the selected
  pair — both with expandable rows showing the full layer snapshot at signal time plus signal id,
  target move, exit price, evaluated-over, MFE, MAE, created/resolved timestamps.
- Activity log panel, color-coded by level (`signal` amber, `warn` orange, `error` rose, else
  slate).
- Footer disclaimer: "Educational analytics only. Not financial advice. Market data: OKX public
  API."

## Deployment models (must support both, don't conflate them)

1. **Serverless (Vercel etc.)** — no background process; an external scheduler (Vercel Cron, a
   GitHub Action, any cron provider) calls `GET /api/tick?force=1` with the `TICK_SECRET` on a
   schedule. All state lives in Postgres, so this is safe with multiple concurrent instances; the
   only per-instance state is the throttle/lock, and its worst-case failure mode is a slightly
   higher tick rate, never corrupted data (the DB-level cooldown check and the unique
   `(symbol, mode)` index on `readings` hold regardless of which instance runs them).
2. **Self-hosted (VM / Docker / `next start` left running)** — an optional
   `ENABLE_BACKGROUND_TICK=1` env var starts an interval loop inside `instrumentation.ts`, guarded
   by a `globalThis` flag so Next.js dev-mode reloads can't stack duplicate loops. Must be off by
   default and never enabled automatically, since every cold start on serverless would spin up
   its own orphaned loop.

## Design notes worth keeping (don't "simplify" these away)

- Market-structure z-scores must be computed from history **fetched from the exchange each
  time**, not accumulated in a local in-memory tracker — the latter loses its history on every
  restart and disagrees across serverless instances.
- The evaluator's EXPIRED/INCORRECT split and its conservative both-levels-in-one-candle
  tie-break are both load-bearing for the accuracy numbers being honest; don't collapse them.
- `activity_log` must actually be written to on every log call — a schema table that's declared
  but never inserted into is worse than no table, since it looks like a feature that doesn't
  exist.
- Keep DTO type definitions (wire format, snake_case) in exactly one place, with a thin
  row→DTO mapper layer separate from them — don't let two files each define their own copy of
  the same shape.

## Tests to include

Pure-function unit tests only (no DB/network fixtures needed):
- Evaluator: CORRECT via TP only, INCORRECT via SL only, both-in-one-candle tie-break resolves
  INCORRECT, EXPIRED after the window with neither level hit, `null` when genuinely still
  pending, and resolution that depends on a later candle in a multi-candle window (not just the
  first one) — for both BUY and SELL.
- Indicator math: rounding/price-rounding at different magnitudes, `clamp`, RSI's neutral
  fallback and its 100-when-all-gains case, z-score's zero-variance and above-mean cases.
- The constant-time secret comparison: equal strings, different strings of equal length,
  different-length strings (must not throw), empty-string cases.

## Explicit non-goals

No trade execution, no backtesting engine, no portfolio tracking, no user accounts/auth beyond
the two shared-secret routes, no support for exchanges other than OKX (a typed direct REST client
is intentionally preferred over a multi-exchange SDK for this scope), no claim that the tuned
layer weights are validated against historical data — `/api/accuracy` accumulating over time is
the only real evidence of how a given mode performs, and needs dozens of resolved signals before
it means anything.
