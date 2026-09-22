/**
 * Validation for POST /api/admin/reload-config, pulled out of the route
 * handler so it's a pure function that can be unit tested without spinning
 * up Next.js, Postgres, or the advisory lock. The route only ever calls
 * `validatePayload` and trusts its `valid` flag — no validation logic lives
 * in the route file itself.
 */
import { LAYER_NAMES, MODE_CONFIG, type Mode } from "./config";

export const ALLOWED_MODE_FIELDS = new Set(["weights", "minConfidence", "cooldownMinutes"]);

export type ValidationResult = { valid: boolean; error?: string };

export function validatePayload(payload: unknown): ValidationResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { valid: false, error: "payload must be a JSON object" };
  }
  const obj = payload as Record<string, unknown>;
  const allowedTop = new Set(["modes"]);
  const unknownTop = Object.keys(obj).filter((k) => !allowedTop.has(k));
  if (unknownTop.length) {
    return { valid: false, error: `fields not allowed: ${JSON.stringify(unknownTop)}` };
  }

  if ("modes" in obj) {
    const modes = obj.modes;
    if (typeof modes !== "object" || modes === null || Array.isArray(modes)) {
      return { valid: false, error: "modes must be an object" };
    }
    for (const [modeName, modeUpdates] of Object.entries(modes as Record<string, unknown>)) {
      if (!(modeName in MODE_CONFIG)) {
        return { valid: false, error: `unknown mode: ${modeName}` };
      }
      if (typeof modeUpdates !== "object" || modeUpdates === null || Array.isArray(modeUpdates)) {
        return { valid: false, error: `modes.${modeName} must be an object` };
      }
      const updates = modeUpdates as Record<string, unknown>;
      const unknownFields = Object.keys(updates).filter((f) => !ALLOWED_MODE_FIELDS.has(f));
      if (unknownFields.length) {
        return { valid: false, error: `modes.${modeName}: fields not allowed: ${JSON.stringify(unknownFields)}` };
      }
      if ("weights" in updates) {
        const weights = updates.weights;
        if (typeof weights !== "object" || weights === null || Array.isArray(weights)) {
          return { valid: false, error: `modes.${modeName}.weights must be an object` };
        }
        for (const [k, v] of Object.entries(weights as Record<string, unknown>)) {
          if (!(LAYER_NAMES as readonly string[]).includes(k)) {
            return { valid: false, error: `modes.${modeName}.weights.${k} is not a known scoring layer` };
          }
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
            return { valid: false, error: `modes.${modeName}.weights.${k} must be a non-negative number` };
          }
        }
        const proposed = { ...MODE_CONFIG[modeName as Mode].weights, ...(weights as Record<string, number>) } as Record<string, number>;
        const total = Object.values(proposed).reduce((sum, v) => sum + v, 0);
        if (total < 0.5 || total > 1.5) {
          return { valid: false, error: `modes.${modeName}.weights must sum to roughly 1.0 (accepted range 0.5-1.5)` };
        }
      }
      if ("minConfidence" in updates) {
        const v = updates.minConfidence;
        if (typeof v !== "number" || v < 0 || v > 100) {
          return { valid: false, error: `modes.${modeName}.minConfidence must be 0-100` };
        }
      }
      if ("cooldownMinutes" in updates) {
        const v = updates.cooldownMinutes;
        if (typeof v !== "number" || v < 0) {
          return { valid: false, error: `modes.${modeName}.cooldownMinutes must be >= 0` };
        }
      }
    }
  }

  return { valid: true };
}
