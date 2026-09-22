import { runTick } from "@/lib/engine";
import { checkSecret } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const url = new URL(request.url);
  const wantsForce = url.searchParams.get("force") === "1";

  // Normal scans are deliberately browser-callable and throttled. A forced
  // scan bypasses the throttle and is always protected by TICK_SECRET.
  if (wantsForce) {
    const check = checkSecret(request, "TICK_SECRET");
    if (!check.configured) {
      return Response.json({ error: "TICK_SECRET must be configured before force=1 is allowed" }, { status: 503 });
    }
    if (!check.ok) {
      return Response.json({ error: "invalid or missing secret for force=1" }, { status: 401 });
    }
  }

  const result = await runTick(wantsForce);
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
