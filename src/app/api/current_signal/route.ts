import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { readings } from "@/db/schema";
import { toReadingDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const mode = url.searchParams.get("mode");
  if (!symbol || !mode) {
    return Response.json({ error: "symbol and mode are required" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(readings)
    .where(and(eq(readings.symbol, symbol), eq(readings.mode, mode)))
    .limit(1);

  if (!row) return Response.json({});
  return Response.json(toReadingDTO(row));
}
