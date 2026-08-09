import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/store";
import { runCustomPanelSpec, type CustomPanelSpec } from "@/lib/dashboard-chat";

/** Always re-queries live — a persisted custom panel never replays a stale snapshot. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const panel = db.data.dashboardPanels.find((p) => p.id === id);
  if (!panel || !panel.spec) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await runCustomPanelSpec(panel.spec as unknown as CustomPanelSpec);
  return NextResponse.json({ data });
}
