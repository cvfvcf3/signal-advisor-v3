import { describe, expect, it } from "vitest";
import { sanitizeModeConfig } from "../configStore";
import { MODE_CONFIG, MODES } from "../config";

describe("sanitizeModeConfig", () => {
  it("returns null for garbage input (not an object)", () => {
    expect(sanitizeModeConfig(null)).toBeNull();
    expect(sanitizeModeConfig("corrupt")).toBeNull();
    expect(sanitizeModeConfig([1, 2, 3])).toBeNull();
  });

  it("returns a full config for every mode even when given an empty object", () => {
    const result = sanitizeModeConfig({});
    expect(result).not.toBeNull();
    for (const mode of MODES) {
      expect(result![mode]).toBeDefined();
      expect(result![mode].minConfidence).toBe(MODE_CONFIG[mode].minConfidence);
    }
  });

  it("clamps an out-of-range minConfidence instead of accepting it verbatim", () => {
    const result = sanitizeModeConfig({ scalp: { minConfidence: 500 } });
    expect(result!.scalp.minConfidence).toBe(100);
    const result2 = sanitizeModeConfig({ scalp: { minConfidence: -50 } });
    expect(result2!.scalp.minConfidence).toBe(0);
  });

  it("clamps a negative cooldownMinutes to 0 rather than storing a negative value", () => {
    // Note: this is intentionally more lenient than validatePayload (which
    // rejects negative cooldowns outright at the API boundary). This
    // function's job is defensive repair of whatever ended up in the
    // database row, not strict input validation — so it clamps instead of
    // discarding the whole field back to default.
    const result = sanitizeModeConfig({ scalp: { cooldownMinutes: -100 } });
    expect(result!.scalp.cooldownMinutes).toBe(0);
  });

  it("accepts zero and positive cooldownMinutes as-is", () => {
    const result = sanitizeModeConfig({ day: { cooldownMinutes: 0 } });
    expect(result!.day.cooldownMinutes).toBe(0);
  });

  it("ignores an unrecognized weight key but keeps valid ones", () => {
    const result = sanitizeModeConfig({
      scalp: { weights: { technical: 0.5, madeUpLayer: 999 } },
    });
    expect(result!.scalp.weights.technical).toBe(0.5);
    expect((result!.scalp.weights as Record<string, number>).madeUpLayer).toBeUndefined();
  });

  it("ignores a negative weight and keeps the default for that layer", () => {
    const result = sanitizeModeConfig({ scalp: { weights: { technical: -1 } } });
    expect(result!.scalp.weights.technical).toBe(MODE_CONFIG.scalp.weights.technical);
  });

  it("is resilient to a partially-corrupt row: one bad mode doesn't invalidate the others", () => {
    const result = sanitizeModeConfig({
      scalp: { minConfidence: 70 },
      day: "not an object",
      swing: { cooldownMinutes: 400 },
    });
    expect(result).not.toBeNull();
    expect(result!.scalp.minConfidence).toBe(70);
    expect(result!.day.minConfidence).toBe(MODE_CONFIG.day.minConfidence); // fell back to default
    expect(result!.swing.cooldownMinutes).toBe(400);
  });
});
