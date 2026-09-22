/**
 * Shared secret check for the two write-adjacent routes in this app:
 *   - POST /api/admin/reload-config (persists runtime scoring configuration)
 *   - POST/GET /api/tick with ?force=1 (bypasses the tick throttle)
 *
 * There is still no endpoint anywhere that places, cancels, or modifies an
 * exchange order — this app only ever reads market data. The secret check
 * exists to stop a stranger from hammering these two routes, not to guard
 * money movement.
 *
 * Reads the secret from `envVar` on every call (not cached at import time)
 * so a rotated env var takes effect on next request without a redeploy.
 */
import { timingSafeEqual } from "node:crypto";

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, so pad to equal length first
  // (the padded comparison always fails, but takes constant time to do so).
  if (bufA.length !== bufB.length) {
    const padded = Buffer.alloc(bufA.length);
    timingSafeEqual(bufA, padded);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function extractProvidedSecret(request: Request): string {
  // Header only, deliberately. A `?secret=` query string ends up in server
  // access logs, reverse-proxy logs, and browser history — exactly the
  // places a leaked admin/tick secret would sit around indefinitely.
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export type SecretCheck =
  | { ok: true; configured: true }
  | { ok: false; configured: false } // env var not set on the server at all
  | { ok: false; configured: true }; // env var set, but request didn't match it

/**
 * Checks `request` against the secret configured in `envVar`.
 * `configured: false` means the operator hasn't set the env var yet — the
 * caller decides whether that's an error (admin route) or a soft-allow
 * with a warning (tick route, so local/dev use still works out of the box).
 */
export function checkSecret(request: Request, envVar: string): SecretCheck {
  const expected = process.env[envVar];
  if (!expected) return { ok: false, configured: false };
  const provided = extractProvidedSecret(request);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return { ok: false, configured: true };
  }
  return { ok: true, configured: true };
}
