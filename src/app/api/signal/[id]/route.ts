import { eq } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { toSignalDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(signals).where(eq(signals.signalId, id)).limit(1);
  if (!row) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(toSignalDTO(row));
}
