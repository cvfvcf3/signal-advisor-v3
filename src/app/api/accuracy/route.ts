import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const mode = url.searchParams.get("mode");

  const filters: SQL[] = [];
  if (symbol) filters.push(eq(signals.symbol, symbol));
  if (mode) filters.push(eq(signals.mode, mode));

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${signals.status} = 'CORRECT')::int`,
      incorrect: sql<number>`count(*) filter (where ${signals.status} = 'INCORRECT')::int`,
      pending: sql<number>`count(*) filter (where ${signals.status} = 'PENDING')::int`,
      expired: sql<number>`count(*) filter (where ${signals.status} = 'EXPIRED')::int`,
      avgConfidence: sql<number | null>`round(avg(${signals.confidence})::numeric, 2)::float8`,
      avgMfe: sql<number | null>`round(avg(${signals.mfePct})::numeric, 3)::float8`,
      avgMae: sql<number | null>`round(avg(${signals.maePct})::numeric, 3)::float8`,
    })
    .from(signals)
    .where(filters.length ? and(...filters) : undefined);

  const decided = (row?.correct ?? 0) + (row?.incorrect ?? 0);
  const accuracy =
    decided > 0 ? Math.round(((row.correct / decided) * 100 + Number.EPSILON) * 10) / 10 : null;

  return Response.json({
    symbol: symbol ?? "ALL",
    mode: mode ?? "ALL",
    total: row?.total ?? 0,
    correct: row?.correct ?? 0,
    incorrect: row?.incorrect ?? 0,
    pending: row?.pending ?? 0,
    expired: row?.expired ?? 0,
    accuracy_pct: accuracy,
    avg_confidence: row?.avgConfidence ?? null,
    avg_mfe_pct: row?.avgMfe ?? null,
    avg_mae_pct: row?.avgMae ?? null,
  });
}
