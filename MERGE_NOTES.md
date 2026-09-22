# Merge notes

You gave me two prototypes of the same app and asked me to verify both and build one good
version, adding anything I thought was missing. This is what I kept from each, what I fixed, and
what I added. Being upfront about this so nothing here is a mystery later.

## What came from which prototype

**Base structure: "repo2"** (`analyze-website-content.zip`, despite the name — it was the same
signal-advisor app, not website analysis). Its API routes, Postgres-backed `readings` and
`activity_log` tables, `layers.ts` scoring, and `indicators.ts` math were already solid and
serverless-friendly, so they're the foundation.

**Pulled in from "repo1"** (`signal-advisor-v2-repository.zip`):
- The evaluator's path-aware, **conservative** TP/SL tie-break (repo2's evaluator assumed
  take-profit was hit first when both levels landed in one candle — an optimistic bias that
  would have inflated the advisor's own accuracy stats). Rewrote it against repo2's object-based
  `Candle` type and added the `EXPIRED` status distinction. See `src/lib/evaluator.ts`.
- Telegram alerting on new signals (repo2 didn't have this at all).
- CSV/JSON export and the single-signal-by-id route (repo1 had both; repo2 had neither).
- The admin config-reload route's shape (allow-listed field validation) — rewritten against
  repo2's config structure and with a timing-attack fix (see below).

## Bugs fixed, not just merged

- **Repo2's `/api/tick` had no auth at all** on `force=1`, which bypasses its throttle. Added
  `TICK_SECRET` gating for `force=1` specifically (see README "Security" for why not the whole
  route).
- **Repo1's admin-token check used `!==` on a plain string**, which leaks timing information
  byte-by-byte. Both secret checks now go through `constantTimeEqual` in `src/lib/auth.ts`
  (`crypto.timingSafeEqual` under the hood).
- **Repo1's `activity_log` table existed in the schema but was never written to** — `logActivity`
  only pushed to an in-memory array, so the table was dead weight and logs didn't survive a
  restart. The merged version writes to Postgres (repo2's approach) and actually uses the index
  that was already declared on it.
- **Repo1's market-structure layer kept its own rolling funding/OI history in a class instance
  in memory** (`MarketStructureTracker`), which loses its history on every restart and disagrees
  across serverless instances. Went with repo2's approach instead: pull history straight from
  OKX's own history endpoints, so the layer is stateless and correct in either deployment model.
- **The evaluator (both repos) could evaluate against a still-forming candle** whose high/low can
  still move before it closes — technically a form of repainting. `resolvePending` in
  `engine.ts` now explicitly excludes any candle where `time + barMs > now`.
- Repo2's `types.ts` and `serialize.ts` each defined their own copy of `SignalDTO`/`ReadingDTO`.
  Consolidated to one definition (`types.ts`) with `serialize.ts` doing only row→DTO conversion.

## Added, not present in either prototype

- `TICK_SECRET` / `ADMIN_SECRET` env-gated auth (see above).
- One retry on transient OKX request failures (`src/lib/okx.ts`) — a parallel tick hitting 7
  symbols × multiple endpoints is exactly the kind of burst where one flaky request shouldn't
  drop an entire symbol's reading for that cycle.
- `notified` boolean on the `signals` row, so a Telegram alert can't be sent twice for the same
  signal across ticks.
- Unit tests for the evaluator, the indicator math, and the constant-time comparison
  (`src/lib/__tests__/`) — the parts of this app worth pinning down with tests, since they're
  pure functions with no network/DB dependency.
- `.env.example`, this file, and the expanded README (deployment models, security rationale,
  architecture map).
- `instrumentation.ts` for the self-hosted deployment path, explicitly gated off by default so
  it can't accidentally run on serverless.

## Left out on purpose

- Repo1's full dynamic-config-from-file reload system (it supported more than weights/thresholds
  and added surface area I didn't think earned its complexity for what this app needs). The
  merged admin route covers weights, min-confidence, and cooldown per mode — the knobs actually
  worth tuning without a redeploy.
- `ccxt` (repo1's exchange abstraction). This app only ever talks to OKX; a direct, typed REST
  client (repo2's approach, kept and hardened) is lighter and exactly as capable for that one
  exchange. If you want a second exchange later, that's when the abstraction earns its keep.

## Second pass: audit findings fixed (this round)

A follow-up review (static code read, no build/test run — same network limitation as below)
found and fixed:

- **README title was stale** ("Signal Advisor v2" survived from the merge). Now says v3.
- **SWING mode was missing its 1w confirmation timeframe.** Spec calls for 4h main / 1d higher /
  1w additional confirmation; the code only read 4H/1D. Added `"1W"` bar support to `okx.ts`
  (duration + a 1h cache TTL, since a weekly candle only closes once a week) and to `engine.ts`'s
  per-tick candle fetch, and added `"1W"` to `MODE_CONFIG.swing.htf` in `config.ts`.
- **Admin/tick secrets accepted a `?secret=` query-string fallback**, which is exactly the kind
  of thing that ends up sitting in server access logs, reverse-proxy logs, and browser history.
  `auth.ts` now only accepts `Authorization: Bearer <secret>`.
- **A stale/misleading comment in `admin/reload-config/route.ts`** claimed the config change
  was "in memory only... lost on the next cold start." That was never true of this merged
  version — `saveRuntimeConfig` persists to the `app_config` table and every instance reloads
  it via `loadRuntimeConfig()` at the top of every tick. Rewrote the comment to describe what
  the code actually does instead of what an earlier draft did.
- **Test coverage was thin.** Added:
  - `adminValidation.test.ts` — valid weights, negative weights, unknown layer keys, malformed
    weight totals, invalid `minConfidence`/`cooldownMinutes`, unknown top-level/mode fields.
    (Pulled `validatePayload` out of the route file into `lib/adminValidation.ts` so it's a pure
    function importable by a test — it wasn't exported before.)
  - `configStore.test.ts` — the persisted-config repair path (`sanitizeModeConfig`): garbage
    input, partially-corrupt rows, out-of-range clamping, unknown weight keys ignored.
  - `telegramNotifier.test.ts` — the backoff formula (extracted to a pure `computeBackoffDelayMs`
    export) and message formatting (disclaimer text present, all five layers listed, graceful
    handling of a null TP/SL).
  - `layers.test.ts` — `buildReading` end to end: BUY/SELL on aligned trends, WAIT on choppy
    data, a conflicting-HTF case that must not resolve to BUY, and a 1W-timeframe smoke test for
    swing mode.

## What I could not verify here

No network access in this environment, so I could not run `npm install`, `npm run typecheck`,
`npm run lint`, `npm test`, or actually connect to Postgres/OKX to exercise this end to end.
Everything above was written and hand-reviewed line by line, and the parts most likely to have a
subtle bug (the evaluator) have unit tests you can run yourself — but "hand-reviewed" is not the
same guarantee as "ran green." Please run `npm install && npm run typecheck && npm test` before
you trust this in front of real money decisions.

This round's fixes have the same limitation, one level deeper: `npm install` failed outright in
this sandbox (registry 403, no egress), so the four new test files above were also written by
hand-tracing `buildReading`'s scoring math rather than by running vitest against them. They're
built to be robust to that — `layers.test.ts`'s HTF-conflict test, for example, compares the net
score between two readings that are identical except for one layer's input, so the assertion
holds by construction rather than by a hand-computed number landing on the right side of a
threshold — but `npm test` is still the thing that actually confirms all of this compiles and
passes, not this note.
