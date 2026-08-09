import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/store";

/** Removing any (removable) panel is always available — a kept panel isn't permanent. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const panel = db.data.dashboardPanels.find((p) => p.id === id);
  if (!panel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!panel.removable) return NextResponse.json({ error: "this panel is not removable" }, { status: 403 });
  db.data.dashboardPanels = db.data.dashboardPanels.filter((p) => p.id !== id);
  await db.write();
  return NextResponse.json({ ok: true });
}
