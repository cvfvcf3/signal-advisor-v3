/**
 * Optional background tick loop for self-hosted / long-running deployments
 * (a VM, a Docker container, `next start` left running). Off by default.
 *
 * On serverless (Vercel and similar) do NOT enable this — there is no
 * long-running process to hold the interval, and every cold start would
 * spin up a new one. Use an external scheduler (e.g. Vercel Cron) that
 * calls `GET /api/tick` on a schedule instead; see README "Deployment
 * models" for both setups.
 *
 * Guarded by a globalThis flag so Next.js's dev-mode module reloads don't
 * stack up duplicate intervals.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ENABLE_BACKGROUND_TICK !== "1") return;

  const globalForLoop = globalThis as typeof globalThis & {
    __signalAdvisorLoopStarted?: boolean;
  };
  if (globalForLoop.__signalAdvisorLoopStarted) return;
  globalForLoop.__signalAdvisorLoopStarted = true;

  const { runTick, log } = await import("./lib/engine");
  const intervalMs = Number(process.env.TICK_INTERVAL_MS ?? 30_000);

  console.log(`[instrumentation] background tick loop enabled, every ${intervalMs}ms`);
  const loop = async () => {
    try {
      await runTick();
    } catch (err) {
      console.error("[instrumentation] tick loop error:", err);
    }
  };
  void loop();
  setInterval(() => void loop(), intervalMs);
  void log("background tick loop started");
}
