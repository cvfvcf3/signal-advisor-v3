import { desc } from "drizzle-orm";
import { db } from "@/db";
import { readings } from "@/db/schema";
import { toReadingDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select()
    .from(readings)
    .orderBy(desc(readings.confidence));
  return Response.json(rows.map(toReadingDTO));
}
