import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appConfig } from "@/db/schema";
import { MODE_CONFIG, MODES, type LayerName, type Mode, type ModeConfig } from "./config";

const CONFIG_ROW_ID = 1;

type PersistedModeConfig = Record<Mode, ModeConfig>;

function cloneConfig(): PersistedModeConfig {
  return structuredClone(MODE_CONFIG) as PersistedModeConfig;
}

export function sanitizeModeConfig(value: unknown): PersistedModeConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const defaults = cloneConfig();
  const merged = cloneConfig();
  for (const mode of MODES) {
    const incoming = candidate[mode];
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) continue;
    const src = incoming as Record<string, unknown>;
    const dst = merged[mode];
    if (typeof src.minConfidence === "number" && Number.isFinite(src.minConfidence)) dst.minConfidence = Math.min(100, Math.max(0, src.minConfidence));
    if (typeof src.cooldownMinutes === "number" && Number.isFinite(src.cooldownMinutes)) dst.cooldownMinutes = Math.max(0, src.cooldownMinutes);
    if (src.weights && typeof src.weights === "object" && !Array.isArray(src.weights)) {
      const weights = src.weights as Record<string, unknown>;
      for (const layer of Object.keys(dst.weights) as LayerName[]) {
        const v = weights[layer];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) dst.weights[layer] = v;
      }
    }
  }
  // Reject malformed persisted rows rather than allowing arbitrary runtime values.
  for (const mode of MODES) {
    if (!merged[mode] || !defaults[mode]) return null;
  }
  return merged;
}

export async function loadRuntimeConfig(): Promise<PersistedModeConfig> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ROW_ID)).limit(1);
  if (!row) {
    const defaults = cloneConfig();
    await db.insert(appConfig).values({ id: CONFIG_ROW_ID, modeConfig: defaults });
    return defaults;
  }
  const parsed = sanitizeModeConfig(row.modeConfig);
  if (!parsed) {
    const defaults = cloneConfig();
    await db.update(appConfig).set({ modeConfig: defaults, updatedAt: new Date(), updatedBy: "system-repair" }).where(eq(appConfig.id, CONFIG_ROW_ID));
    return defaults;
  }
  applyRuntimeConfig(parsed);
  return parsed;
}

export function applyRuntimeConfig(config: PersistedModeConfig) {
  for (const mode of MODES) {
    MODE_CONFIG[mode].minConfidence = config[mode].minConfidence;
    MODE_CONFIG[mode].cooldownMinutes = config[mode].cooldownMinutes;
    MODE_CONFIG[mode].weights = { ...config[mode].weights };
  }
}

export async function saveRuntimeConfig(config: PersistedModeConfig, updatedBy = "admin") {
  await db.insert(appConfig)
    .values({ id: CONFIG_ROW_ID, modeConfig: config, updatedAt: new Date(), updatedBy })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: { modeConfig: config, updatedAt: new Date(), updatedBy },
    });
  applyRuntimeConfig(config);
}
