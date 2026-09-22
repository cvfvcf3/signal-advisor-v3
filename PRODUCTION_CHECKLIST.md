# Production Release Checklist

## Database
- [ ] Set `DATABASE_URL` to the production Postgres instance.
- [ ] Run `npm run db:push` against the intended database.
- [ ] Confirm tables `signals`, `readings`, `activity_log`, `app_config`, and `notification_outbox` exist.
- [ ] Enable automated Postgres backups/point-in-time recovery at the hosting layer.

## Secrets
- [ ] Set a long random `TICK_SECRET`.
- [ ] Set a separate long random `ADMIN_SECRET`.
- [ ] Set Telegram secrets only if alerts are required.
- [ ] Never expose secrets through the browser, dashboard config, or source control.

## Runtime
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Verify `/api/health` returns `{ ok: true }`.
- [ ] Verify `/api/readings` and `/api/symbols` return current data.
- [ ] Trigger a normal `/api/tick` and verify the activity log.
- [ ] Trigger `force=1` with the correct secret and verify unauthorized requests are rejected.

## Signal integrity
- [ ] Confirm only closed candles are used for scoring.
- [ ] Confirm a pending signal resolves only once.
- [ ] Confirm TP/SL same-candle tie-break is `INCORRECT`.
- [ ] Confirm `EXPIRED` is excluded from accuracy denominator.
- [ ] Confirm signal layer snapshots remain immutable after config changes.
- [ ] Confirm multiple application instances cannot run the tick simultaneously.

## Notifications
- [ ] Send a test Telegram alert.
- [ ] Verify `notification_outbox` changes to `SENT`.
- [ ] Simulate a failed Telegram request and verify retry/backoff.
- [ ] Verify `signals.notified` becomes true after successful delivery.

## Operations
- [ ] Use a 30–60s external scheduler for serverless, or the background loop for one long-running host.
- [ ] Monitor DB availability, OKX failures, tick duration, and notification failures.
- [ ] Keep Postgres backups and a rollback copy of the previous deployment.
