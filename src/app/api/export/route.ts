import { and, asc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { signals, type SignalRow } from "@/db/schema";

export const dynamic = "force-dynamic";

const CSV_COLUMNS: (keyof SignalRow)[] = [
  "signalId",
  "createdAt",
  "symbol",
  "mode",
  "action",
  "confidence",
  "entryPrice",
  "takeProfit",
  "stopLoss",
  "status",
  "resolvedAt",
  "exitPrice",
  "maePct",
  "mfePct",
  "notified",
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const mode = searchParams.get("mode");
  const format = (searchParams.get("format") ?? "csv").toLowerCase();

  const filters: SQL[] = [];
  if (symbol) filters.push(eq(signals.symbol, symbol));
  if (mode) filters.push(eq(signals.mode, mode));

  const rows = await db
    .select()
    .from(signals)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(signals.createdAt))
    .limit(100000);

  if (format === "json") {
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=signal_history.json",
      },
    });
  }

  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=signal_history.csv",
    },
  });
}
