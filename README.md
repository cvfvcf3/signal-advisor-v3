# Signal Advisor v3 — production-grade read-only crypto signal engine

A read-only, multi-coin, multi-mode crypto signal advisor for OKX spot markets. It never places,
cancels, or modifies exchange orders. It scores each configured symbol/mode using technical,
HTF, order-book, market-structure and SMC layers, journals BUY/SELL signals, evaluates them only
against fully closed candles, and exposes a dashboard/API for transparent analytics.

## Production hardening included

- **Distributed PostgreSQL advisory lock** around the whole tick: concurrent Railway/Vercel workers
  cannot run the signal-emission phase simultaneously.
- **Durable runtime configuration** in PostgreSQL: admin tuning survives restarts and is shared by
  every instance.
- **Anti-repainting candle boundary**: the scoring engine receives fully closed candles only.
- **Conservative evaluator**: stop-loss wins when both TP and SL are touched in one candle;
  EXPIRED remains distinct from INCORRECT.
- **Transactional notification outbox** for Telegram with retries/backoff and durable delivery
  state. The rare crash window around an external Telegram request is handled as at-least-once
  delivery rather than silently losing an alert.
- **Constant-time secret comparison** for protected routes.
- **Per-symbol fault isolation**, bounded concurrency, OKX retry handling including 429/5xx.
- **Persistent activity log**, signal journal, evaluation metrics and export APIs.
- **No exchange credentials and no trading SDK**. OKX public market endpoints only.

## Quick start

```bash
cp .env.example .env
npm install
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

## Production environment

At minimum:

- `DATABASE_URL`
- `TICK_SECRET`
- `ADMIN_SECRET`

Optional Telegram:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_MIN_CONFIDENCE`

For a public deployment, **do not leave `TICK_SECRET` or `ADMIN_SECRET` empty**.
`force=1` is always protected; it no longer silently becomes public when the secret is missing.
The dashboard uses the normal throttled tick endpoint and therefore does not need a secret in the
browser.

## Deployment

### Railway / Docker / VM

Use one long-running `next start` instance with:

```env
ENABLE_BACKGROUND_TICK=1
TICK_INTERVAL_MS=30000
```

The database advisory lock still protects you if more than one instance is accidentally started.

### Serverless

Keep `ENABLE_BACKGROUND_TICK=0`. Use a scheduler to call:

```text
GET /api/tick?force=1
Authorization: Bearer <TICK_SECRET>
```

A 30–60 second schedule is appropriate. The dashboard also performs normal throttled scans while
it is open.

## Configuration

The initial mode definitions are the documented defaults. Runtime changes to layer weights,
minimum confidence and cooldown are persisted in `app_config` by `/api/admin/reload-config`.
Unknown fields and unknown scoring-layer names are rejected. The immutable signal rows retain their
layer snapshot, so later tuning cannot rewrite historical evidence.

## Data integrity

Signals are emitted only after a Postgres-backed global tick lock is acquired. The emission check
and insert therefore cannot race across concurrent application instances. Readings use a unique
`(symbol, mode)` key. Notification jobs use a unique `(signal_id, channel)` key.

Evaluation is based on closed candles only. A pending signal is resolved to:

- `CORRECT` when TP is touched first;
- `INCORRECT` when SL is touched first;
- `INCORRECT` when both levels are touched in the same candle (conservative tie-break);
- `EXPIRED` when the evaluation window finishes without either level;
- `PENDING` while the required closed-candle window is not yet available.

Accuracy is `correct / (correct + incorrect)`, excluding pending and expired from the denominator.

## Tests

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

The repository contains pure-function tests for evaluator behavior, indicator edge cases and
constant-time authentication. Before production release, run the full commands above against the
actual Node/Postgres environment used by the deployment.

## Explicit non-goals

No trade execution, no portfolio management, no exchange private API, no user account system, and
no claim that the hand-tuned weights have been historically validated. `/api/accuracy` is an
observational journal metric, not a promise of future performance.

