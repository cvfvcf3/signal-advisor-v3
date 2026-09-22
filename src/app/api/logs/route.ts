import { desc } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 30) || 30, 1),
    200,
  );
  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);

  return Response.json(
    rows.map((r) => ({
      id: r.id,
      level: r.level,
      message: r.message,
      time: new Date(r.createdAt).toISOString(),
    })),
  );
}
