import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";

export async function GET() {
  const db = await getDb();
  return NextResponse.json({ panels: db.data.dashboardPanels.filter((p) => p.kind === "custom") });
}
