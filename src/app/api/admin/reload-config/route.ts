/**
 * The one write-capable route in the app — and even this only ever touches
 * scoring weights/thresholds, never exchange credentials or trading
 * behavior. There is no order-placing endpoint anywhere in this app.
 *
 * Runtime config IS durable: this route applies the change to the in-memory
 * MODE_CONFIG for the instance that served the request (so it takes effect
 * immediately, no redeploy) AND persists it to the `app_config` table via
 * saveRuntimeConfig. Every instance picks up the persisted row the next
 * time it calls loadRuntimeConfig() (engine.ts does this at the start of
 * every tick), so a change made through one instance is visible to every
 * other instance within one tick cycle, not lost on the next cold start.
 *
 * Payload validation lives in ./adminValidation.ts as a pure function so it
 * can be unit tested without Next.js/Postgres in the loop.
 */
import { MODE_CONFIG, type Mode, type LayerName } from "@/lib/config";
import { loadRuntimeConfig, saveRuntimeConfig } from "@/lib/configStore";
import { log, withAdvisoryLock } from "@/lib/engine";
import { checkSecret } from "@/lib/auth";
import { validatePayload } from "@/lib/adminValidation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const check = checkSecret(request, "ADMIN_SECRET");
  if (!check.configured) {
    return Response.json({ error: "ADMIN_SECRET is not configured on the server" }, { status: 503 });
  }
  if (!check.ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const { valid, error } = validatePayload(payload);
  if (!valid) {
    return Response.json({ error }, { status: 400 });
  }

  const obj = payload as { modes?: Record<string, Partial<Record<"weights" | "minConfidence" | "cooldownMinutes", unknown>>> };

  const applied = await withAdvisoryLock("signal-advisor:global-tick:v2", async () => {
    const current = await loadRuntimeConfig();
    if (obj.modes) {
      for (const [modeName, updates] of Object.entries(obj.modes)) {
        const cfg = MODE_CONFIG[modeName as Mode];
        if (updates.weights) {
          Object.assign(cfg.weights, updates.weights as Partial<Record<LayerName, number>>);
          Object.assign(current[modeName as Mode].weights, updates.weights as Partial<Record<LayerName, number>>);
        }
        if (typeof updates.minConfidence === "number") {
          cfg.minConfidence = updates.minConfidence;
          current[modeName as Mode].minConfidence = updates.minConfidence;
        }
        if (typeof updates.cooldownMinutes === "number") {
          cfg.cooldownMinutes = updates.cooldownMinutes;
          current[modeName as Mode].cooldownMinutes = updates.cooldownMinutes;
        }
      }
    }
    await saveRuntimeConfig(current, "admin");
    return current;
  });
  if (applied === null) return Response.json({ error: "tick/configuration lock is busy; retry shortly" }, { status: 409 });
  await log(`config reloaded and persisted: ${JSON.stringify(Object.keys(obj.modes ?? {}))}`, "warn");
  return Response.json({ status: "ok", applied: obj, mode_config: MODE_CONFIG });
}
