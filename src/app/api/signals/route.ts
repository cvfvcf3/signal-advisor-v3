import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { toSignalDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const mode = url.searchParams.get("mode");
  const status = url.searchParams.get("status");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1),
    200,
  );

  const filters: SQL[] = [];
  if (symbol) filters.push(eq(signals.symbol, symbol));
  if (mode) filters.push(eq(signals.mode, mode));
  if (status) filters.push(eq(signals.status, status));

  const rows = await db
    .select()
    .from(signals)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return Response.json(rows.map(toSignalDTO));
}
